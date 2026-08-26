import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeCause, log, newRequestId } from "./telemetry";

// The logger writes to console, so that is what gets read back. Production
// mode, because that is where the JSON shape matters and where a leak would
// actually be shipped.
const original = process.env.NODE_ENV;
let written: string[] = [];

beforeEach(() => {
  written = [];
  vi.stubEnv("NODE_ENV", "production");
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((text: unknown) => {
      written.push(String(text));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("NODE_ENV", original ?? "test");
});

const lastLine = () =>
  JSON.parse(written[written.length - 1]) as Record<string, unknown>;

const trace = {
  requestId: "req-1",
  userId: "user-1",
  turnId: "turn-1",
  messageId: "msg-1",
  model: "some/model",
  attempt: 2,
};

describe("the shape of a line", () => {
  it("is one JSON object carrying the event and its correlation", () => {
    log.info("generation_claimed", trace);

    expect(lastLine()).toMatchObject({
      level: "info",
      event: "generation_claimed",
      ...trace,
    });
  });

  it("timestamps every line", () => {
    log.info("anything", trace);
    expect(String(lastLine().at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("writes errors to stderr and information to stdout", () => {
    log.error("bad", trace);
    expect(console.error).toHaveBeenCalled();
    log.info("fine", trace);
    expect(console.log).toHaveBeenCalled();
  });

  it("leaves out correlation it does not have", () => {
    log.info("early", { requestId: "req-2" });
    const line = lastLine();
    // A line written before a row exists should not claim empty ids.
    expect(line).not.toHaveProperty("messageId");
    expect(line).not.toHaveProperty("model");
    expect(line.requestId).toBe("req-2");
  });

  it("keeps a request id joinable across lines", () => {
    log.info("first", trace);
    log.warn("second", trace);
    const ids = written.map((line) => JSON.parse(line).requestId);
    expect(new Set(ids).size).toBe(1);
  });
});

describe("what must never reach a log", () => {
  it("replaces anything long enough to be content with its length", () => {
    // A prompt or an answer cannot be logged even by a caller who tries.
    const prompt = "tell me a secret ".repeat(50);
    log.info("generation_claimed", trace, { prompt });

    const line = lastLine();
    expect(line.prompt).toBe(`[${prompt.length} chars]`);
    expect(String(line.prompt)).not.toContain("secret");
  });

  it("keeps short values, which are the useful ones", () => {
    log.info("generation_failed", trace, {
      kind: "upstream_busy",
      status: 429,
    });
    expect(lastLine()).toMatchObject({ kind: "upstream_busy", status: 429 });
  });

  it("drops fields that were not provided rather than logging undefined", () => {
    log.info("x", trace, { present: 1, missing: undefined });
    const line = lastLine();
    expect(line.present).toBe(1);
    expect(line).not.toHaveProperty("missing");
  });
});

describe("describeCause", () => {
  it("keeps an error's name and message", () => {
    expect(describeCause(new TypeError("bad input"))).toBe(
      "TypeError: bad input",
    );
  });

  it("refuses to dump a thrown object", () => {
    // A thrown value can carry a request body or a connection string; only its
    // type is safe to state.
    expect(describeCause({ password: "hunter2", body: "..." })).toBe("object");
    expect(describeCause("a string")).toBe("string");
  });

  it("stays bounded when the error message is enormous", () => {
    const huge = new Error("x".repeat(5_000));
    log.error("stream_read_failed", trace, { cause: describeCause(huge) });
    expect(String(lastLine().cause)).toMatch(/^\[\d+ chars\]$/);
  });
});

describe("newRequestId", () => {
  it("is unique per call", () => {
    const ids = Array.from({ length: 50 }, newRequestId);
    expect(new Set(ids).size).toBe(50);
  });
});
