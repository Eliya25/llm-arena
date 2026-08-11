import { getOwnThreads } from "@/app/arena/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { getFreeModelCatalog } from "@/lib/openrouter";

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export default async function ModelsPage() {
  const [catalog, threads] = await Promise.all([
    getFreeModelCatalog(),
    getOwnThreads(),
  ]);

  return (
    <AppShell breadcrumb="Models" threads={threads}>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-3xl font-medium">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The full free-tier catalog, browsable without opening the picker.
          </p>
        </div>

        {catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the model catalog right now. Try again in a
            moment.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((model) => (
              <div
                key={model.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs">
                    {initialFor(model.name)}
                  </span>
                  <span className="truncate font-medium">{model.name}</span>
                </div>
                <div className="flex flex-col gap-1.5 border-t border-border pt-3 font-mono text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Context window</span>
                    <span className="text-foreground">
                      {model.contextWindow.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Pricing</span>
                    <span className="text-foreground">$0.0000 / M tokens</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
