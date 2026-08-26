import { describe, expect, it } from "vitest";
import {
  classifyUpstream,
  failure,
  worthRetrying,
  type FailureKind,
} from "./failure";

const EVERY_KIND: FailureKind[] = [
  "invalid_request",
  "unauthenticated",
  "rate_limited",
  "security_denied",
  "upstream_busy",
  "upstream_unavailable",
  "upstream_timeout",
  "catalog_unavailable",
  "model_not_allowed",
  "database",
  "internal",
];

describe("what a person is told", () => {
  it("gives every failure a plain sentence", () => {
    for (const kind of EVERY_KIND) {
      const { message } = failure(kind);
      expect(message.length).toBeGreaterThan(0);
      // A sentence, not a code or a fragment.
      expect(message).toMatch(/^[A-Z].*[.!?]$/);
    }
  });

  it("never leaks the vocabulary of the machine", () => {
    // CLAUDE.md: never a raw exception or provider error. These are the words
    // that would mean one had slipped through.
    const leaks =
      /error:|exception|stack|undefined|null|prisma|postgres|arcjet|clerk|posthog|openrouter|5\d\d|4\d\d/i;
    for (const kind of EVERY_KIND) {
      expect(failure(kind).message).not.toMatch(leaks);
    }
  });

  it("does not send someone to a list that may be empty", () => {
    // The whole reason these two are separate kinds.
    expect(failure("model_not_allowed").message).toContain("model list");
    expect(failure("catalog_unavailable").message).not.toContain(
      "Pick one from",
    );
  });

  it("keeps busy and unavailable as different stories", () => {
    // A 429 is the model answering "I'm full", not silence. Collapsing them
    // sends someone off debugging a prompt that was fine.
    expect(failure("upstream_busy").message).not.toEqual(
      failure("upstream_unavailable").message,
    );
    expect(failure("upstream_busy").message).toMatch(/busy|moment|different/i);
  });
});

describe("classifyUpstream", () => {
  it("reads a 429 as the model being busy", () => {
    expect(classifyUpstream(429).kind).toBe("upstream_busy");
  });

  it("reads a timeout as a timeout", () => {
    expect(classifyUpstream(408).kind).toBe("upstream_timeout");
    expect(classifyUpstream(504).kind).toBe("upstream_timeout");
  });

  it("treats anything it cannot interpret as the provider being down", () => {
    for (const status of [500, 502, 503, 418, 400, 0]) {
      expect(classifyUpstream(status).kind).toBe("upstream_unavailable");
    }
  });
});

describe("worthRetrying", () => {
  it("retries a provider that broke", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(worthRetrying(status)).toBe(true);
    }
  });

  it("never retries a 429", () => {
    // The provider answered clearly. Asking again immediately spends the same
    // quota to be told the same thing, and free models are busy often enough
    // that it would turn a failed lane into a slow one.
    expect(worthRetrying(429)).toBe(false);
  });

  it("never retries the caller's own mistake", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(worthRetrying(status)).toBe(false);
    }
  });

  it("does not retry a success", () => {
    expect(worthRetrying(200)).toBe(false);
  });
});
