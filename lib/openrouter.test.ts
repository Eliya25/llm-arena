import { describe, expect, it } from "vitest";
import { isArenaCompatibleModel } from "./openrouter";

const compatibleModel = {
  id: "example/chat:free",
  name: "Example Chat (free)",
  context_length: 32_000,
  pricing: { prompt: "0", completion: "0" },
  architecture: {
    input_modalities: ["text"],
    output_modalities: ["text"],
  },
};

describe("isArenaCompatibleModel", () => {
  it("keeps an ordinary free text chat model", () => {
    expect(isArenaCompatibleModel(compatibleModel)).toBe(true);
  });

  it.each([
    "thinkingmachines/inkling:free",
    "thinkingmachines/inkling-small:free",
  ])("excludes the agentic only model %s", (id) => {
    expect(isArenaCompatibleModel({ ...compatibleModel, id })).toBe(false);
  });
});
