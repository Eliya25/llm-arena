import { describe, expect, it } from "vitest";
import {
  hashShareToken,
  isValidShareToken,
  newShareToken,
} from "./thread-share";

describe("thread share tokens", () => {
  it("creates URL-safe 256-bit tokens", () => {
    const token = newShareToken();
    expect(token).toHaveLength(43);
    expect(isValidShareToken(token)).toBe(true);
  });

  it("hashes deterministically without storing the token", () => {
    const token = newShareToken();
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    expect(hashShareToken(token)).toHaveLength(64);
    expect(hashShareToken(token)).not.toContain(token);
  });

  it("rejects malformed public tokens before querying", () => {
    expect(isValidShareToken("short")).toBe(false);
    expect(isValidShareToken("!".repeat(43))).toBe(false);
  });
});
