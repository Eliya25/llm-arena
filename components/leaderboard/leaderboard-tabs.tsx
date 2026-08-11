"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import type { LeaderboardRow } from "@/app/leaderboard/leaderboard-data";

export type LeaderboardRowView = LeaderboardRow & { name: string };

type Scope = "global" | "personal";

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function rowMetrics(row: LeaderboardRowView): string {
  const parts = [
    row.avgTokensPerSecond !== null
      ? `${row.avgTokensPerSecond} tok/s avg`
      : null,
    row.avgTimeToFirstTokenMs !== null
      ? `${row.avgTimeToFirstTokenMs}ms to first token avg`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

function Board({
  rows,
  emptyText,
}: {
  rows: LeaderboardRowView[];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ol className="overflow-hidden rounded-lg border border-border">
      {rows.map((row, index) => {
        const metrics = rowMetrics(row);
        const first = index === 0;

        return (
          <li
            key={row.modelId}
            className={cn(
              "flex flex-col gap-3 border-b border-border px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
              // The one subtle first-place highlight — nobody else gets one.
              first && "bg-primary/5",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground"
                aria-hidden
              >
                {initialFor(row.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.name}</p>
                {metrics !== "" && (
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {metrics}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 pl-9 sm:pl-0">
              <span className="font-display text-2xl font-medium text-primary">
                Won {row.wins} of {row.total}
              </span>
              <span
                className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(row.wins / row.total) * 100}%` }}
                />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LeaderboardTabs({
  global,
  personal,
}: {
  global: LeaderboardRowView[];
  // null means signed out — the personal tab invites sign-in instead.
  personal: LeaderboardRowView[] | null;
}) {
  const [scope, setScope] = useState<Scope>("global");

  return (
    <div className="flex flex-col gap-6">
      <div
        className="inline-flex w-fit gap-1 rounded-md border border-border bg-secondary p-1"
        role="group"
        aria-label="Leaderboard scope"
      >
        {(["global", "personal"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setScope(option)}
            aria-pressed={scope === option}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium capitalize",
              scope === option
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {scope === "global" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Every vote cast in the arena, by everyone. While you&apos;re the
            only one voting, this matches your personal board.
          </p>
          <Board
            rows={global}
            emptyText="No votes yet. Pick some winners in the arena."
          />
        </div>
      ) : personal === null ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            Sign in to see a leaderboard built from your own votes.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Only the votes you&apos;ve cast yourself.
          </p>
          <Board
            rows={personal}
            emptyText="You haven't voted yet. Pick some winners in the arena."
          />
        </div>
      )}
    </div>
  );
}
