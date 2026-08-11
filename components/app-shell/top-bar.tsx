"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, PanelLeft } from "lucide-react";

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
  showCopyLink?: boolean;
};

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context) — the
      // address bar still has the link, so silently doing nothing is honest.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Link2 className="h-3.5 w-3.5" aria-hidden />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}

export function TopBar({
  onToggleSidebar,
  breadcrumb,
  models,
  showCopyLink = false,
}: TopBarProps) {
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
        {showCopyLink && <CopyLinkButton />}
      </div>
    </header>
  );
}
