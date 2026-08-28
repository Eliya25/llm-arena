export type CatalogModel = {
  id: string;
  name: string;
  contextWindow: number;
};

type OpenRouterModel = {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

// OpenRouter lists these free variants in the public model catalog, but the
// chat endpoint rejects them unless the caller is an approved agentic
// harness. The catalog currently exposes no capability flag for that access
// restriction, so keep the known incompatible variants out of the arena.
const AGENTIC_ONLY_MODELS = new Set([
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
]);

// The upstream catalog is sorted below by context size, which is useful in the
// picker but a poor availability signal for the three automatic selections.
// Keep a small, tested preference order and fall back to the live catalog when
// OpenRouter removes one of them.
const DEFAULT_MODEL_IDS = [
  "minimax/minimax-m3:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

export function selectDefaultModelIds(
  catalog: readonly CatalogModel[],
  limit: number,
): string[] {
  const available = new Set(catalog.map((model) => model.id));
  const selected = DEFAULT_MODEL_IDS.filter((id) => available.has(id));

  for (const model of catalog) {
    if (selected.length >= limit) break;
    if (!selected.includes(model.id)) selected.push(model.id);
  }

  return selected.slice(0, limit);
}

export function isArenaCompatibleModel(model: OpenRouterModel): boolean {
  if (AGENTIC_ONLY_MODELS.has(model.id)) return false;

  const inputs = model.architecture?.input_modalities ?? [];
  const outputs = model.architecture?.output_modalities ?? [];

  return (
    model.pricing.prompt === "0" &&
    model.pricing.completion === "0" &&
    inputs.includes("text") &&
    outputs.length === 1 &&
    outputs[0] === "text"
  );
}

export async function getFreeModelCatalog(): Promise<CatalogModel[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return [];
    }

    const { data }: OpenRouterModelsResponse = await response.json();

    return (
      data
        // Only models that take text in and produce text and nothing else.
        // Media models (e.g. music generation) list "text" among their outputs
        // too, so the output list must be exactly ["text"] — otherwise they'd
        // land in the arena and fail every chat prompt.
        .filter(isArenaCompatibleModel)
        .map((model) => ({
          id: model.id,
          // Every model here is free — the "(free)" suffix is noise on chips.
          name: model.name.replace(/\s*\(free\)$/i, ""),
          contextWindow: model.context_length,
        }))
        .sort((a, b) => b.contextWindow - a.contextWindow)
    );
  } catch {
    return [];
  }
}
