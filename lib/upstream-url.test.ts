import { describe, expect, it } from "vitest";
import { resolveUpstreamUrl } from "./upstream-url";

describe("resolveUpstreamUrl", () => {
  it("resolves the controlled relative upstream against the current deployment", () => {
    expect(
      resolveUpstreamUrl(
        "/api/load/mock-openrouter",
        "https://preview.example/api/chat",
      ),
    ).toBe("https://preview.example/api/load/mock-openrouter");
  });

  it("preserves the official absolute upstream", () => {
    expect(
      resolveUpstreamUrl(
        "https://openrouter.ai/api/v1/chat/completions",
        "https://preview.example/api/chat",
      ),
    ).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
});
