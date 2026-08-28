import { describe, expect, it } from "vitest";
import {
  isArenaCompatibleModel,
  selectDefaultModelIds,
  type CatalogModel,
} from "./openrouter";

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

describe("selectDefaultModelIds", () => {
  const catalogModel = (id: string): CatalogModel => ({
    id,
    name: id,
    contextWindow: 1,
  });

  it("prefers the tested chat models over catalog order", () => {
    const catalog = [
      catalogModel("unstable/huge:free"),
      catalogModel("nvidia/nemotron-3-super-120b-a12b:free"),
      catalogModel("minimax/minimax-m3:free"),
      catalogModel("inclusionai/ling-3.0-flash-fin:free"),
    ];

    expect(selectDefaultModelIds(catalog, 3)).toEqual([
      "minimax/minimax-m3:free",
      "inclusionai/ling-3.0-flash-fin:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ]);
  });

  it("fills missing preferred models from the live catalog", () => {
    const catalog = [
      catalogModel("fallback/first:free"),
      catalogModel("minimax/minimax-m3:free"),
      catalogModel("fallback/second:free"),
    ];

    expect(selectDefaultModelIds(catalog, 3)).toEqual([
      "minimax/minimax-m3:free",
      "fallback/first:free",
      "fallback/second:free",
    ]);
  });
});
