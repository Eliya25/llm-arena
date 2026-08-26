import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { claimAnswerRow } from "./answer-row";

// Every test invents its own user, so nothing here can collide with anything
// else and cleanup is a single scoped delete.
const users: string[] = [];
const someone = () => {
  const clerkId = `test-${crypto.randomUUID()}`;
  users.push(clerkId);
  return clerkId;
};

const claim = (
  clerkId: string,
  target: Parameters<typeof claimAnswerRow>[0]["target"],
  model = "test/model",
) =>
  claimAnswerRow({
    target,
    model,
    prompt: "a prompt",
    clerkId,
    trace: { requestId: `test-${crypto.randomUUID()}` },
  });

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

describe("claiming a row for a new prompt", () => {
  it("converges three simultaneous lanes on one thread and one turn", async () => {
    // The real shape of a first send: three lanes hit the route at the same
    // moment, each willing to create the thread. Before the unique keys, this
    // was a race the client had to win by creating rows in a parallel action.
    const clerkId = someone();
    const clientKey = crypto.randomUUID();
    const threadKey = crypto.randomUUID();

    const claims = await Promise.all(
      ["model/a", "model/b", "model/c"].map((model) =>
        claim(clerkId, { clientKey, threadKey }, model),
      ),
    );

    expect(claims.every((claim) => claim !== null)).toBe(true);
    expect(new Set(claims.map((claim) => claim?.threadId)).size).toBe(1);
    expect(new Set(claims.map((claim) => claim?.turnId)).size).toBe(1);
    // ...and three distinct rows, one per model.
    expect(new Set(claims.map((claim) => claim?.messageId)).size).toBe(3);

    expect(await prisma.thread.count({ where: { user: { clerkId } } })).toBe(1);
    expect(
      await prisma.message.count({ where: { turnId: claims[0]?.turnId } }),
    ).toBe(3);
  });

  it("gives two lanes racing on the same model distinct attempts", async () => {
    // Both find no row, both try to create it, one loses on the unique index.
    // Whoever loses must not walk away believing it owns attempt 0 as well.
    const clerkId = someone();
    const clientKey = crypto.randomUUID();
    const threadKey = crypto.randomUUID();

    const [first, second] = await Promise.all([
      claim(clerkId, { clientKey, threadKey }),
      claim(clerkId, { clientKey, threadKey }),
    ]);

    expect(first?.messageId).toBe(second?.messageId);
    expect(first?.attempt).not.toBe(second?.attempt);
  });

  it("stores the prompt on the turn it creates", async () => {
    const clerkId = someone();
    const claimed = await claimAnswerRow({
      target: {
        clientKey: crypto.randomUUID(),
        threadKey: crypto.randomUUID(),
      },
      model: "test/model",
      prompt: "what is the capital of France",
      clerkId,
      trace: { requestId: `test-${crypto.randomUUID()}` },
    });

    const turn = await prisma.turn.findUnique({
      where: { id: claimed?.turnId },
      include: { thread: true },
    });
    expect(turn?.prompt).toBe("what is the capital of France");
    // The thread takes its title from the first prompt.
    expect(turn?.thread.title).toBe("what is the capital of France");
  });
});

describe("retrying", () => {
  it("reuses the row, blanks it, and takes the next attempt", async () => {
    const clerkId = someone();
    const first = await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    // Pretend the first attempt finished.
    await prisma.message.update({
      where: { id: first?.messageId },
      data: {
        content: "an answer from the first try",
        status: "SUCCESS",
        outputTokens: 99,
        tokensPerSecond: 12.5,
        timeToFirstTokenMs: 400,
      },
    });

    const retry = await claim(clerkId, { turnId: first?.turnId });

    expect(retry?.messageId).toBe(first?.messageId);
    expect(retry?.attempt).toBe((first?.attempt ?? 0) + 1);

    const row = await prisma.message.findUnique({
      where: { id: first?.messageId },
    });
    expect(row).toMatchObject({
      content: "",
      status: "PENDING",
      outputTokens: null,
      tokensPerSecond: null,
      timeToFirstTokenMs: null,
    });

    // One model still answers one turn once.
    expect(
      await prisma.message.count({ where: { turnId: first?.turnId } }),
    ).toBe(1);
  });

  it("keeps the turn's original prompt", async () => {
    const clerkId = someone();
    const first = await claimAnswerRow({
      target: {
        clientKey: crypto.randomUUID(),
        threadKey: crypto.randomUUID(),
      },
      model: "test/model",
      prompt: "the original question",
      clerkId,
      trace: { requestId: `test-${crypto.randomUUID()}` },
    });

    await claimAnswerRow({
      target: { turnId: first?.turnId },
      model: "test/model",
      prompt: "something else entirely",
      clerkId,
      trace: { requestId: `test-${crypto.randomUUID()}` },
    });

    const turn = await prisma.turn.findUnique({ where: { id: first?.turnId } });
    expect(turn?.prompt).toBe("the original question");
  });
});

describe("the trust boundary", () => {
  it("refuses a clientKey and threadKey belonging to someone else", async () => {
    const owner = someone();
    const clientKey = crypto.randomUUID();
    const threadKey = crypto.randomUUID();
    const mine = await claim(owner, { clientKey, threadKey });

    const intruder = await claim(someone(), { clientKey, threadKey });

    // Not merely a different row — no row at all.
    expect(intruder).toBeNull();
    expect(
      await prisma.message.count({ where: { turnId: mine?.turnId } }),
    ).toBe(1);
  });

  it("refuses a turnId belonging to someone else", async () => {
    const owner = someone();
    const mine = await claim(owner, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    expect(await claim(someone(), { turnId: mine?.turnId })).toBeNull();
  });

  it("refuses a threadId belonging to someone else", async () => {
    const owner = someone();
    const mine = await claim(owner, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    const stolen = await claim(someone(), {
      clientKey: crypto.randomUUID(),
      threadId: mine?.threadId,
    });
    expect(stolen).toBeNull();
  });

  it("refuses identifiers that do not exist at all", async () => {
    const clerkId = someone();
    expect(await claim(clerkId, { turnId: "nope" })).toBeNull();
    expect(
      await claim(clerkId, {
        clientKey: crypto.randomUUID(),
        threadId: "also-nope",
      }),
    ).toBeNull();
  });

  it("lets the owner continue their own thread", async () => {
    const clerkId = someone();
    const first = await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    const followUp = await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadId: first?.threadId,
    });

    expect(followUp?.threadId).toBe(first?.threadId);
    // A follow-up is a new turn, not a rewrite of the last one.
    expect(followUp?.turnId).not.toBe(first?.turnId);
  });
});

describe("abandoned rows", () => {
  it("closes out rows left open longer than any live request could be", async () => {
    // The one case the stall watchdogs cannot cover: the process itself dying
    // and taking every in-flight timer with it.
    const clerkId = someone();
    const stranded = await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.message.update({
      where: { id: stranded?.messageId },
      data: {
        status: "STREAMING",
        content: "half an answer",
        createdAt: longAgo,
      },
    });

    // Anything this user does next sweeps it.
    await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    const swept = await prisma.message.findUnique({
      where: { id: stranded?.messageId },
    });
    expect(swept?.status).toBe("FAILED");
    // What it managed to say is kept.
    expect(swept?.content).toBe("half an answer");
  });

  it("leaves a recently claimed row alone", async () => {
    const clerkId = someone();
    const fresh = await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });
    await prisma.message.update({
      where: { id: fresh?.messageId },
      data: { status: "STREAMING", content: "still going" },
    });

    await claim(clerkId, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    const row = await prisma.message.findUnique({
      where: { id: fresh?.messageId },
    });
    expect(row?.status).toBe("STREAMING");
  });

  it("does not reach another user's stranded rows", async () => {
    const owner = someone();
    const stranded = await claim(owner, {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });
    await prisma.message.update({
      where: { id: stranded?.messageId },
      data: {
        status: "PENDING",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await claim(someone(), {
      clientKey: crypto.randomUUID(),
      threadKey: crypto.randomUUID(),
    });

    const row = await prisma.message.findUnique({
      where: { id: stranded?.messageId },
    });
    expect(row?.status).toBe("PENDING");
  });
});
