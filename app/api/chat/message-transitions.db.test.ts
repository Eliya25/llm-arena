import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { claimAnswerRow, type AnswerRow } from "./answer-row";

// The lifecycle rule, checked against the database that enforces it rather
// than against the code that happens to respect it. Every write here goes
// straight through Prisma with no application guard in front of it, which is
// the point: the rule has to hold for a writer that never read our code.

const users: string[] = [];

const claim = async (): Promise<AnswerRow> => {
  const clerkId = `test-${crypto.randomUUID()}`;
  users.push(clerkId);
  const row = await claimAnswerRow({
    target: { clientKey: crypto.randomUUID(), threadKey: crypto.randomUUID() },
    model: "test/model",
    prompt: "a prompt",
    clerkId,
    trace: { requestId: `test-${crypto.randomUUID()}` },
  });
  if (!row) throw new Error("could not claim a row");
  return row;
};

type Status = "PENDING" | "STREAMING" | "SUCCESS" | "FAILED";

const setStatus = (id: string, status: Status, attempt?: number) =>
  prisma.message.update({
    where: { id },
    data: attempt === undefined ? { status } : { status, attempt },
  });

const statusOf = async (id: string) =>
  (await prisma.message.findUnique({ where: { id }, select: { status: true } }))
    ?.status;

afterAll(async () => {
  const turns = await prisma.turn.findMany({
    where: { thread: { user: { clerkId: { in: users } } } },
    select: { id: true },
  });
  await prisma.message.deleteMany({
    where: { turnId: { in: turns.map((turn) => turn.id) } },
  });
  await prisma.turn.deleteMany({
    where: { thread: { user: { clerkId: { in: users } } } },
  });
  await prisma.thread.deleteMany({
    where: { user: { clerkId: { in: users } } },
  });
  await prisma.user.deleteMany({ where: { clerkId: { in: users } } });
});

describe("the way a generation is allowed to move", () => {
  it("goes PENDING -> STREAMING -> SUCCESS", async () => {
    const row = await claim();
    await setStatus(row.messageId, "STREAMING");
    await setStatus(row.messageId, "SUCCESS");
    expect(await statusOf(row.messageId)).toBe("SUCCESS");
  });

  it("may skip STREAMING, for a stream too short to checkpoint", async () => {
    const row = await claim();
    await setStatus(row.messageId, "SUCCESS");
    expect(await statusOf(row.messageId)).toBe("SUCCESS");
  });

  it("goes straight to FAILED from either live state", async () => {
    const first = await claim();
    await setStatus(first.messageId, "FAILED");
    expect(await statusOf(first.messageId)).toBe("FAILED");

    const second = await claim();
    await setStatus(second.messageId, "STREAMING");
    await setStatus(second.messageId, "FAILED");
    expect(await statusOf(second.messageId)).toBe("FAILED");
  });

  it("lets a checkpoint rewrite content without touching status", async () => {
    const row = await claim();
    await setStatus(row.messageId, "STREAMING");
    await prisma.message.update({
      where: { id: row.messageId },
      data: { content: "more of the answer" },
    });
    expect(await statusOf(row.messageId)).toBe("STREAMING");
  });

  it("lets metrics be corrected on a finished answer", async () => {
    // A data-fix migration did exactly this once, to rows already SUCCESS.
    const row = await claim();
    await setStatus(row.messageId, "SUCCESS");
    await prisma.message.update({
      where: { id: row.messageId },
      data: { tokensPerSecond: 42.5 },
    });
    expect(await statusOf(row.messageId)).toBe("SUCCESS");
  });
});

describe("the way it is not", () => {
  it("refuses to undo a success", async () => {
    const row = await claim();
    await setStatus(row.messageId, "SUCCESS");

    await expect(setStatus(row.messageId, "FAILED")).rejects.toThrow(
      /already SUCCESS/,
    );
    await expect(setStatus(row.messageId, "PENDING")).rejects.toThrow(
      /already SUCCESS/,
    );
    await expect(setStatus(row.messageId, "STREAMING")).rejects.toThrow(
      /already SUCCESS/,
    );
    expect(await statusOf(row.messageId)).toBe("SUCCESS");
  });

  it("refuses to promote a failure into an answer", async () => {
    // The invariant with the sharpest edge: a failed generation must never be
    // published as a successful one.
    const row = await claim();
    await setStatus(row.messageId, "FAILED");

    await expect(setStatus(row.messageId, "SUCCESS")).rejects.toThrow(
      /already FAILED/,
    );
    expect(await statusOf(row.messageId)).toBe("FAILED");
  });

  it("refuses to send a live stream back to the start", async () => {
    const row = await claim();
    await setStatus(row.messageId, "STREAMING");

    await expect(setStatus(row.messageId, "PENDING")).rejects.toThrow(
      /cannot go back to PENDING/,
    );
    expect(await statusOf(row.messageId)).toBe("STREAMING");
  });

  it("refuses an attempt that goes backwards", async () => {
    const row = await claim();
    await expect(
      setStatus(row.messageId, "PENDING", row.attempt - 1),
    ).rejects.toThrow(/attempt may not go backwards/);
  });

  it("refuses a new attempt that does not start clean", async () => {
    // Claiming a row for a retry and marking it succeeded in one step would
    // publish an answer nothing ever produced.
    const row = await claim();
    await setStatus(row.messageId, "SUCCESS");

    await expect(
      setStatus(row.messageId, "SUCCESS", row.attempt + 1),
    ).rejects.toThrow(/must start at PENDING/);
    await expect(
      setStatus(row.messageId, "STREAMING", row.attempt + 1),
    ).rejects.toThrow(/must start at PENDING/);
  });
});

describe("a new attempt", () => {
  it("is the one thing that may reset a finished answer", async () => {
    // The transition the scope had listed as forbidden. It is what every
    // retry does, and enforcing the rule as written would have broken all of
    // them.
    const row = await claim();
    await setStatus(row.messageId, "SUCCESS");

    await setStatus(row.messageId, "PENDING", row.attempt + 1);

    expect(await statusOf(row.messageId)).toBe("PENDING");
  });

  it("is what claimAnswerRow actually does", async () => {
    // Not a synthetic update: the real claim path, against the real trigger.
    const row = await claim();
    await setStatus(row.messageId, "SUCCESS");

    const turn = await prisma.turn.findUnique({
      where: { id: row.turnId },
      select: { thread: { select: { user: { select: { clerkId: true } } } } },
    });

    const retry = await claimAnswerRow({
      target: { turnId: row.turnId },
      model: "test/model",
      prompt: "a prompt",
      clerkId: turn?.thread.user.clerkId ?? "",
      trace: { requestId: `test-${crypto.randomUUID()}` },
    });

    expect(retry?.attempt).toBe(row.attempt + 1);
    expect(await statusOf(row.messageId)).toBe("PENDING");
  });
});
