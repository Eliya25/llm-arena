"use client";

import { PanelLeft } from "lucide-react";
import { ShareDialog } from "./share-dialog";

export type ModelBadge = {
  id: string;
  initial: string;
  label: string;
  wins: number;
  total: number;
};

type TopBarProps = {
  onToggleSidebar: () => void;
  breadcrumb: string;
  models: ModelBadge[];
  threadControls?: { threadId: string; initiallyShared: boolean };
};

export function TopBar({
  onToggleSidebar,
  breadcrumb,
  models,
  threadControls,
}: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/80 bg-background/80 px-4 backdrop-blur-xl sm:px-5">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
      >
        <PanelLeft className="h-4 w-4" aria-hidden />
      </button>

      <span className="h-4 w-px bg-border" aria-hidden />
      <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
        <span className="truncate font-medium text-foreground">
          {breadcrumb}
        </span>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {models.map((model) => (
          <span
            key={model.id}
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
        {threadControls && <ShareDialog {...threadControls} />}
      </div>
    </header>
  );
}
