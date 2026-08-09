import { AppShell } from "@/components/app-shell/app-shell";

type ModelCard = {
  initial: string;
  name: string;
  contextWindow: string;
  pricePerMillionTokens: string;
};

const PLACEHOLDER_MODELS: ModelCard[] = [
  {
    initial: "N",
    name: "NVIDIA: Nemotron 3 Ultra",
    contextWindow: "128K context",
    pricePerMillionTokens: "$0.0000 / M tokens",
  },
  {
    initial: "Q",
    name: "Qwen 3 Coder",
    contextWindow: "32K context",
    pricePerMillionTokens: "$0.0000 / M tokens",
  },
  {
    initial: "P",
    name: "Phi 4 Reasoning",
    contextWindow: "16K context",
    pricePerMillionTokens: "$0.0000 / M tokens",
  },
];

export default function ModelsPage() {
  return (
    <AppShell breadcrumb="Models">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-3xl font-medium">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The full free-tier catalog, browsable without opening the picker.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLACEHOLDER_MODELS.map((model) => (
            <div
              key={model.name}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs">
                  {model.initial}
                </span>
                <span className="truncate font-medium">{model.name}</span>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-border pt-3 font-mono text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Context window</span>
                  <span className="text-foreground">{model.contextWindow}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Pricing</span>
                  <span className="text-foreground">
                    {model.pricePerMillionTokens}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
