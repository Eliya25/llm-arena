import { PanelLeft } from "lucide-react";

export type ModelBadge = {
  initial: string;
  label: string;
  wins: number;
  total: number;
};

type TopBarProps = {
  onToggleSidebar: () => void;
  breadcrumb: string;
  models: ModelBadge[];
};

export function TopBar({ onToggleSidebar, breadcrumb, models }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"
      >
        <PanelLeft className="h-4 w-4" aria-hidden />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
        <span className="truncate font-medium text-foreground">
          {breadcrumb}
        </span>
      </nav>

      {models.length > 0 && (
        <div className="ml-auto flex items-center gap-2">
          {models.map((model) => (
            <span
              key={model.initial}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 font-mono text-xs"
              title={`${model.label}: won ${model.wins} of ${model.total}`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden
              />
              <span className="hidden sm:inline">{model.initial}</span>
              <span>
                {model.wins}/{model.total}
              </span>
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
