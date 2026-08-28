import { getOwnThreads } from "@/app/arena/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { getFreeModelCatalog } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

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
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8 sm:py-14">
        <div>
          <p className="mb-3 font-mono text-[10px] tracking-[0.2em] text-primary uppercase">
            Free-tier field
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
            Models
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            The full free-tier catalog, browsable without opening the picker.
          </p>
        </div>

        {catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the model catalog right now. Try again in a
            moment.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((model) => (
              <div
                key={model.id}
                className="soft-shadow group flex flex-col gap-4 rounded-xl border border-border bg-card/90 p-5 transition-[transform,border-color] hover:-translate-y-0.5 hover:border-primary/35"
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
