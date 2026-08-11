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
        .filter(
          (model) =>
            model.pricing.prompt === "0" && model.pricing.completion === "0",
        )
        // Only models that take text in and produce text and nothing else.
        // Media models (e.g. music generation) list "text" among their outputs
        // too, so the output list must be exactly ["text"] — otherwise they'd
        // land in the arena and fail every chat prompt.
        .filter((model) => {
          const inputs = model.architecture?.input_modalities ?? [];
          const outputs = model.architecture?.output_modalities ?? [];
          return (
            inputs.includes("text") &&
            outputs.length === 1 &&
            outputs[0] === "text"
          );
        })
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
