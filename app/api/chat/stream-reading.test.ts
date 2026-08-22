import { describe, expect, it } from "vitest";
import {
  BLANK_READING,
  absorb,
  absorbLine,
  measure,
  type Cursor,
} from "./stream-reading";

const cursor = (over: Partial<Cursor> = {}): Cursor => ({
  reading: BLANK_READING,
  buffer: "",
  checkpointedAt: 0,
  pending: new Promise(() => {}),
  ...over,
});

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}`;
const delta = (content: string) => sse({ choices: [{ delta: { content } }] });

describe("absorbLine", () => {
  it("keeps text and stamps the first and last token from the chunk's arrival", () => {
    const first = absorbLine(BLANK_READING, delta("Hello"), 1000);
    const second = absorbLine(first, delta(" world"), 1400);

    expect(second.content).toBe("Hello world");
    // First token stays where it was; last advances.
    expect(second.firstTokenAt).toBe(1000);
    expect(second.lastTokenAt).toBe(1400);
  });

  it("ignores everything that is not a data line", () => {
    const noise = [
      ": keep-alive",
      "",
      "event: ping",
      "data: [DONE]",
      "data: {",
    ];
    const after = noise.reduce(
      (reading, line) => absorbLine(reading, line, 500),
      BLANK_READING,
    );
    expect(after).toEqual(BLANK_READING);
  });

  it("does not treat an empty delta as a token", () => {
    // A role-only opening frame must not start the clock — the watchdog
    // switches budgets on the first *content*, not the first frame.
    const after = absorbLine(
      BLANK_READING,
      sse({ choices: [{ delta: { role: "assistant" } }] }),
      700,
    );
    expect(after.firstTokenAt).toBeNull();
    expect(after.content).toBe("");
  });

  it("keeps a reported zero as zero rather than falling back", () => {
    const after = absorbLine(
      BLANK_READING,
      sse({ choices: [{ delta: {} }], usage: { completion_tokens: 0 } }),
      100,
    );
    expect(after.outputTokens).toBe(0);
  });

  it("lets a later usage frame correct an earlier one", () => {
    const first = absorbLine(
      BLANK_READING,
      sse({ choices: [{ delta: {} }], usage: { completion_tokens: 10 } }),
      100,
    );
    const second = absorbLine(
      first,
      sse({ choices: [{ delta: {} }], usage: { completion_tokens: 42 } }),
      200,
    );
    expect(second.outputTokens).toBe(42);
  });
});

describe("absorb", () => {
  it("carries a line split across two chunks", () => {
    // The network splits wherever it likes, including mid-JSON.
    const line = delta("split");
    const half = Math.floor(line.length / 2);

    const first = absorb(cursor(), line.slice(0, half), 100);
    expect(first.reading.content).toBe("");

    const second = absorb(first, `${line.slice(half)}\n`, 200);
    expect(second.reading.content).toBe("split");
    // Timed by the chunk that completed it.
    expect(second.reading.firstTokenAt).toBe(200);
  });

  it("holds an unterminated line rather than parsing it early", () => {
    const after = absorb(cursor(), delta("no newline yet"), 100);
    expect(after.reading.content).toBe("");
    expect(after.buffer).toBe(delta("no newline yet"));
  });

  it("folds several lines from one chunk", () => {
    const after = absorb(
      cursor(),
      `${delta("a")}\n${delta("b")}\n${delta("c")}\n`,
      100,
    );
    expect(after.reading.content).toBe("abc");
  });
});

describe("measure", () => {
  it("computes the pinned definitions", () => {
    const reading = {
      ...BLANK_READING,
      outputTokens: 40,
      firstTokenAt: 1500,
      lastTokenAt: 3500,
    };
    const metrics = measure(reading, 1000);

    // Headers -> first token.
    expect(metrics.timeToFirstTokenMs).toBe(500);
    // First token -> last token.
    expect(metrics.generationDurationMs).toBe(2000);
    // Tokens over the WHOLE window, headers -> last token: 40 / 2.5s.
    expect(metrics.tokensPerSecond).toBeCloseTo(16, 5);
  });

  it("does not charge reasoning time to the streaming window", () => {
    // The real row that forced this definition: 829 tokens, 49 characters,
    // 5882ms of thinking and 263ms of delivery. Over the streaming window
    // alone this stored 3152 tok/s and went into the leaderboard.
    const reading = {
      ...BLANK_READING,
      outputTokens: 829,
      firstTokenAt: 5882,
      lastTokenAt: 6145,
    };
    const metrics = measure(reading, 0);

    expect(Math.round(metrics.tokensPerSecond ?? 0)).toBe(135);
    expect(metrics.tokensPerSecond).toBeLessThan(200);
  });

  it("leaves every metric null when nothing was reported", () => {
    expect(measure(BLANK_READING, 1000)).toEqual({
      timeToFirstTokenMs: null,
      generationDurationMs: null,
      tokensPerSecond: null,
    });
  });

  it("reports a rate only when tokens were reported", () => {
    // Text arrived but upstream never sent usage: a duration is real, a rate
    // would have to be invented.
    const metrics = measure(
      { ...BLANK_READING, firstTokenAt: 1200, lastTokenAt: 2200 },
      1000,
    );
    expect(metrics.generationDurationMs).toBe(1000);
    expect(metrics.tokensPerSecond).toBeNull();
  });

  it("refuses to divide by a window of zero", () => {
    const metrics = measure(
      {
        ...BLANK_READING,
        outputTokens: 10,
        firstTokenAt: 1000,
        lastTokenAt: 1000,
      },
      1000,
    );
    expect(metrics.tokensPerSecond).toBeNull();
    expect(metrics.generationDurationMs).toBe(0);
  });
});
