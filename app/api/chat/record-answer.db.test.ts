import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { claimAnswerRow, type AnswerRow } from "./answer-row";
import { markAnswerFailed, recordAnswer } from "./record-answer";

// These are the scenarios that were written as throwaway scripts ten times
// during Feature 1, because each one caught something real. They are here so
// that stops happening.

const users: string[] = [];
const encoder = new TextEncoder();

const claim = async (model = "test/model"): Promise<AnswerRow> => {
  const clerkId = `test-${crypto.randomUUID()}`;
  users.push(clerkId);
  const row = await claimAnswerRow({
    target: { clientKey: crypto.randomUUID(), threadKey: crypto.randomUUID() },
    model,
    prompt: "a prompt",
    clerkId,
  });
  if (!row) throw new Error("could not claim a row");
  return row;
};

const retryOf = async (row: AnswerRow, clerkId: string) => {
  const retry = await claimAnswerRow({
    target: { turnId: row.turnId },
    model: "test/model",
    prompt: "a prompt",
    clerkId,
  });
  if (!retry) throw new Error("could not claim the retry");
  return retry;
};

const ownerOf = async (row: AnswerRow) => {
  const turn = await prisma.turn.findUnique({
    where: { id: row.turnId },
    select: { thread: { select: { user: { select: { clerkId: true } } } } },
  });
  return turn?.thread.user.clerkId ?? "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (payload: unknown) =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
const delta = (content: string) => frame({ choices: [{ delta: { content } }] });
const usage = (completion_tokens: number) =>
  frame({ choices: [{ delta: {} }], usage: { completion_tokens } });
const done = () => encoder.encode("data: [DONE]\n\n");

const record = (
  row: AnswerRow,
  stream: ReadableStream<Uint8Array>,
  onProgress: (hasFirstToken: boolean) => void = () => {},
) =>
  recordAnswer(stream, {
    messageId: row.messageId,
    attempt: row.attempt,
    model: "test/model",
    distinctId: "test",
    upstreamAt: performance.now(),
    onProgress,
  });

const rowFor = (row: AnswerRow) =>
  prisma.message.findUnique({ where: { id: row.messageId } });

// How far a recorded measurement may sit from what the stream itself timed.
// Wide enough to survive a loaded machine, far narrower than any of the
// mistakes these tests exist to catch — the metric regression they were
// written for was off by more than two seconds.
const TIMING_TOLERANCE_MS = 400;

const measured = (recorded: number | null | undefined, actual: number) => {
  expect(recorded).not.toBeNull();
  expect(Math.abs((recorded ?? 0) - actual)).toBeLessThan(TIMING_TOLERANCE_MS);
};

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

describe("a stream that finishes cleanly", () => {
  it("stores the answer and the measurements it actually took", async () => {
    const row = await claim();
    // The stream reports its own timings, and the recorder is checked against
    // those rather than against the sleeps that produced them. A busy machine
    // stretches a sleep and would wobble a fixed bound; it stretches both of
    // these equally, so what is being asserted stays "the recorder measured
    // this stream" instead of "this machine was not busy".
    const sent = { start: 0, firstToken: 0, lastToken: 0 };
    const result = await record(
      row,
      new ReadableStream({
        async start(controller) {
          sent.start = performance.now();
          await sleep(500);
          sent.firstToken = performance.now();
          controller.enqueue(delta("Hello"));
          await sleep(1000);
          sent.lastToken = performance.now();
          controller.enqueue(delta(" world"));
          controller.enqueue(usage(40));
          controller.enqueue(done());
          controller.close();
        },
      }),
    );

    expect(result?.status).toBe("SUCCESS");
    measured(result?.timeToFirstTokenMs, sent.firstToken - sent.start);
    measured(result?.generationDurationMs, sent.lastToken - sent.firstToken);

    const stored = await rowFor(row);
    expect(stored).toMatchObject({ content: "Hello world", status: "SUCCESS" });
    expect(stored?.outputTokens).toBe(40);
    // What was returned to the browser is what was written down.
    expect(stored?.tokensPerSecond).toBeCloseTo(
      result?.tokensPerSecond ?? 0,
      5,
    );
  });

  it("does not charge a database write to the model as generation time", async () => {
    // A checkpoint comes due while a chunk is already waiting. Timestamping
    // when the loop got round to the chunk, rather than when it arrived, once
    // recorded a 2500ms generation as 4804ms.
    const row = await claim();
    const sent = { firstToken: 0, lastToken: 0 };
    const result = await record(
      row,
      new ReadableStream({
        async start(controller) {
          sent.firstToken = performance.now();
          controller.enqueue(delta("first"));
          // Long enough that a checkpoint falls due inside the gap.
          await sleep(2500);
          sent.lastToken = performance.now();
          controller.enqueue(delta(" last"));
          controller.enqueue(usage(10));
          controller.enqueue(done());
          controller.close();
        },
      }),
    );

    const actual = sent.lastToken - sent.firstToken;
    measured(result?.generationDurationMs, actual);
    // The bug this exists for inflated a 2500ms span to 4804ms. Stated as a
    // ratio so it keeps its meaning however slow the machine is.
    expect(result?.generationDurationMs ?? 0).toBeLessThan(actual * 1.4);
  });

  it("saves progress midway rather than holding everything to the end", async () => {
    const row = await claim();
    const running = record(
      row,
      new ReadableStream({
        async start(controller) {
          controller.enqueue(delta("saved midway"));
          await sleep(3500);
          controller.enqueue(done());
          controller.close();
        },
      }),
    );

    await sleep(2600);
    const midFlight = await rowFor(row);
    expect(midFlight?.content).toBe("saved midway");
    expect(midFlight?.status).toBe("STREAMING");

    await running;
    expect((await rowFor(row))?.status).toBe("SUCCESS");
  });
});

describe("a stream that does not finish cleanly", () => {
  it("keeps the text it managed and calls it failed", async () => {
    const row = await claim();
    const result = await record(
      row,
      new ReadableStream({
        async start(controller) {
          controller.enqueue(delta("half an answer"));
          await sleep(50);
          controller.error(new Error("upstream died"));
        },
      }),
    );

    expect(result?.status).toBe("FAILED");
    expect(await rowFor(row)).toMatchObject({
      content: "half an answer",
      status: "FAILED",
    });
  });

  it("treats a clean finish with nothing in it as a failure", async () => {
    // Real: a model reported 79 tokens of usage and not one visible
    // character. As a success it would be an empty card that can be voted for.
    const row = await claim();
    const result = await record(
      row,
      new ReadableStream({
        start(controller) {
          controller.enqueue(usage(79));
          controller.enqueue(done());
          controller.close();
        },
      }),
    );

    expect(result?.status).toBe("FAILED");
    expect((await rowFor(row))?.status).toBe("FAILED");
  });

  it("tells the watchdog the first token has landed", async () => {
    const row = await claim();
    const reports: boolean[] = [];
    await record(
      row,
      new ReadableStream({
        async start(controller) {
          controller.enqueue(frame({ choices: [{ delta: { role: "a" } }] }));
          await sleep(50);
          controller.enqueue(delta("token"));
          await sleep(50);
          controller.enqueue(done());
          controller.close();
        },
      }),
      (hasFirstToken) => reports.push(hasFirstToken),
    );

    // False for the opening frame, true from the chunk carrying the first
    // token onward — which is what switches the watchdog to its short budget.
    expect(reports[0]).toBe(false);
    expect(reports.slice(1).every(Boolean)).toBe(true);
  });
});

describe("an attempt that has been replaced", () => {
  it("cannot overwrite the answer that replaced it", async () => {
    const row = await claim();
    const clerkId = await ownerOf(row);

    const slow = record(
      row,
      new ReadableStream({
        async start(controller) {
          controller.enqueue(delta("OLD ATTEMPT"));
          await sleep(3000);
          controller.enqueue(usage(999));
          controller.enqueue(done());
          controller.close();
        },
      }),
    );

    await sleep(300);
    const retry = await retryOf(row, clerkId);
    const fresh = await record(
      retry,
      new ReadableStream({
        start(controller) {
          controller.enqueue(delta("NEW ATTEMPT"));
          controller.enqueue(usage(42));
          controller.enqueue(done());
          controller.close();
        },
      }),
    );
    expect(fresh?.status).toBe("SUCCESS");

    // The old one finishes last, and must land nowhere.
    expect(await slow).toBeNull();

    expect(await rowFor(row)).toMatchObject({
      content: "NEW ATTEMPT",
      outputTokens: 42,
      attempt: retry.attempt,
    });
  });

  it("lets go of the upstream once it has been replaced", async () => {
    const row = await claim();
    const clerkId = await ownerOf(row);

    let cancelled = false;
    let framesSent = 0;
    const started = Date.now();
    const orphan = record(
      row,
      new ReadableStream({
        async start(controller) {
          // No visible text at all — a model still working through reasoning.
          // This never met the old check, which only ran when there was
          // content to save, so the connection was held to the end.
          for (let i = 0; i < 20; i += 1) {
            controller.enqueue(frame({ choices: [{ delta: {} }] }));
            framesSent += 1;
            await sleep(500);
          }
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await sleep(700);
    await retryOf(row, clerkId);

    expect(await orphan).toBeNull();
    expect(cancelled).toBe(true);
    expect(framesSent).toBeLessThan(20);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("notices even while the upstream is completely silent", async () => {
    const row = await claim();
    const clerkId = await ownerOf(row);

    let cancelled = false;
    const started = Date.now();
    const orphan = record(
      row,
      new ReadableStream({
        async start(controller) {
          controller.enqueue(delta("a few words, then nothing"));
          // Nothing for a chunk-driven check to ride on.
          await sleep(30_000);
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await sleep(700);
    await retryOf(row, clerkId);

    expect(await orphan).toBeNull();
    expect(cancelled).toBe(true);
    // Caught on the checkpoint interval, not thirty seconds later.
    expect(Date.now() - started).toBeLessThan(12_000);
  });

  it("cannot mark the live answer failed either", async () => {
    const row = await claim();
    const clerkId = await ownerOf(row);
    const retry = await retryOf(row, clerkId);

    await prisma.message.update({
      where: { id: retry.messageId },
      data: { status: "SUCCESS", content: "the new answer" },
    });

    // The replaced attempt's upstream call fails, late.
    await markAnswerFailed(row.messageId, row.attempt);

    expect(await rowFor(row)).toMatchObject({
      status: "SUCCESS",
      content: "the new answer",
    });
  });

  it("still records a failure for the attempt that owns the row", async () => {
    const row = await claim();
    await markAnswerFailed(row.messageId, row.attempt);
    expect((await rowFor(row))?.status).toBe("FAILED");
  });
});
