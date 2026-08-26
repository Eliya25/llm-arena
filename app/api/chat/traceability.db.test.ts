import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "@/lib/prisma";
import { log, newRequestId, type Correlation } from "@/lib/telemetry";
import { claimAnswerRow } from "./answer-row";
import { recordAnswer } from "./record-answer";

// The stated test for Feature 4: one failed turn can be reconstructed from
// telemetry. Written as a test rather than performed once by hand, because a
// thing verified once and then deleted is how the six throwaway scripts of
// Feature 1 happened.

const users: string[] = [];
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lines: Record<string, unknown>[] = [];

beforeEach(() => {
  lines = [];
  vi.stubEnv("NODE_ENV", "production");
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((text: unknown) => {
      const raw = String(text);
      if (raw.startsWith("{")) lines.push(JSON.parse(raw));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

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

// One request, run the way the route runs it.
async function generationThatDiesPartway() {
  const clerkId = `test-${crypto.randomUUID()}`;
  users.push(clerkId);
  const model = "poolside/laguna-s-2.1:free";

  const requestId = newRequestId();
  let trace: Correlation = { requestId, model, userId: clerkId };

  const row = await claimAnswerRow({
    target: { clientKey: crypto.randomUUID(), threadKey: crypto.randomUUID() },
    model,
    prompt: "a prompt the user typed, which must never appear in a log",
    clerkId,
    trace,
  });
  if (!row) throw new Error("could not claim a row");

  trace = {
    ...trace,
    threadId: row.threadId,
    turnId: row.turnId,
    messageId: row.messageId,
    attempt: row.attempt,
  };
  log.info("generation_claimed", trace, {});

  await recordAnswer(
    new ReadableStream({
      async start(controller) {
        await sleep(400);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "Neymar was born in" } }],
            })}\n\n`,
          ),
        );
        await sleep(150);
        controller.error(new Error("connection reset by peer"));
      },
    }),
    {
      messageId: row.messageId,
      attempt: row.attempt,
      model,
      distinctId: clerkId,
      upstreamAt: performance.now(),
      onProgress: () => {},
      trace,
    },
  );

  return { requestId, row, model };
}

describe("reconstructing a failed turn from telemetry alone", () => {
  it("tells the whole story, joined by one request id", async () => {
    const { requestId, row, model } = await generationThatDiesPartway();

    // Everything this request wrote, found the way an on-call person would
    // find it: by the id the browser was handed.
    const story = lines.filter((line) => line.requestId === requestId);
    const events = story.map((line) => line.event);

    // Claimed, started answering, ended badly. That sequence is the answer to
    // "it stopped halfway through".
    expect(events).toContain("generation_claimed");
    expect(events).toContain("generation_first_token");
    expect(events).toContain("stream_read_failed");
    expect(events).toContain("generation_finished");

    // Every line carries the row, so the story can be joined the other way
    // too — from a suspicious database row back to what happened to it.
    for (const line of story) {
      expect(line.messageId).toBe(row.messageId);
      expect(line.attempt).toBe(row.attempt);
      expect(line.model).toBe(model);
    }
  });

  it("says when the model started answering, and how long it took", async () => {
    await generationThatDiesPartway();

    const firstToken = lines.find(
      (line) => line.event === "generation_first_token",
    );
    // The distinction between "never answered" and "stopped partway" is the
    // one a report of this kind turns on.
    expect(firstToken?.ttftMs).toBeGreaterThan(300);
    expect(firstToken?.ttftMs).toBeLessThan(2_000);
  });

  it("records the outcome as interrupted, not merely failed", async () => {
    await generationThatDiesPartway();

    const finished = lines.find((line) => line.event === "generation_finished");
    expect(finished).toMatchObject({
      status: "FAILED",
      outcome: "interrupted",
      stored: true,
    });
    // It kept what the model managed to say — the log agrees with the row.
    expect(finished?.contentLength).toBe("Neymar was born in".length);
  });

  it("names the cause without quoting anything unbounded", async () => {
    await generationThatDiesPartway();

    const failure = lines.find((line) => line.event === "stream_read_failed");
    expect(failure?.cause).toBe("Error: connection reset by peer");
  });

  it("never writes the prompt or the answer anywhere", async () => {
    await generationThatDiesPartway();

    const everything = JSON.stringify(lines);
    expect(everything).not.toContain("a prompt the user typed");
    expect(everything).not.toContain("Neymar was born in");
    // The length of the answer is a fact worth having; the answer is not.
    expect(everything).toContain("contentLength");
  });

  it("keeps a healthy generation visible too", async () => {
    // Without this, every rate has an unknown denominator: only failures were
    // ever recorded before.
    const clerkId = `test-${crypto.randomUUID()}`;
    users.push(clerkId);
    const trace: Correlation = { requestId: newRequestId(), userId: clerkId };

    const row = await claimAnswerRow({
      target: {
        clientKey: crypto.randomUUID(),
        threadKey: crypto.randomUUID(),
      },
      model: "test/model",
      prompt: "hello",
      clerkId,
      trace,
    });
    if (!row) throw new Error("could not claim a row");

    await recordAnswer(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "hi" } }],
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      {
        messageId: row.messageId,
        attempt: row.attempt,
        model: "test/model",
        distinctId: clerkId,
        upstreamAt: performance.now(),
        onProgress: () => {},
        trace: { ...trace, messageId: row.messageId, attempt: row.attempt },
      },
    );

    const finished = lines.find((line) => line.event === "generation_finished");
    expect(finished).toMatchObject({ status: "SUCCESS", level: "info" });
  });
});
