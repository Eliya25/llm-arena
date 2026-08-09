import { ArrowUp, Plus, X } from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";

const PLACEHOLDER_MODELS = [
  { initial: "P", label: "Phi 4 Reasoning", wins: 0, total: 0 },
  { initial: "Q", label: "Qwen 3 Coder", wins: 0, total: 0 },
  { initial: "N", label: "Nemotron 3 Ultra", wins: 0, total: 0 },
];

export default function ArenaPage() {
  return (
    <AppShell breadcrumb="Arena" models={PLACEHOLDER_MODELS}>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="max-w-2xl font-display text-4xl font-medium text-balance sm:text-5xl">
            Ask three models at once
          </h1>
          <p className="max-w-xl text-base text-balance text-muted-foreground">
            One prompt goes to every model you pick. They answer side by side,
            each with its own real speed and token count, and you decide which
            one was actually worth it.
          </p>
        </div>

        <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-6">
          <div className="rounded-lg border border-border bg-card p-4">
            <textarea
              rows={2}
              readOnly
              placeholder="Ask anything. Enter to send, shift + enter for a new line."
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {PLACEHOLDER_MODELS.map((model) => (
                <span
                  key={model.initial}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-sm text-secondary-foreground"
                >
                  {model.label}
                  <X className="h-3 w-3" aria-hidden />
                </span>
              ))}
              <button
                type="button"
                title="Not built yet"
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm font-medium hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add model
              </button>
              <button
                type="button"
                aria-label="Send prompt"
                title="Not built yet"
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Up to three models at a time. Every one of them is free.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
