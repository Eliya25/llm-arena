"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, CircleUserRound, Moon, Swords, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: typeof Swords;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Arena", icon: Swords, href: "/arena" },
  { label: "Leaderboard", icon: Trophy, href: "/leaderboard" },
  { label: "Models", icon: Boxes, href: "/models" },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-14 shrink-0 items-center px-4">
        <span
          className={cn(
            "truncate font-display text-lg font-medium",
            collapsed && "sr-only",
          )}
        >
          LLM Arena
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-2" aria-label="Main">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          const active = pathname === href;

          return (
            <Link
              key={label}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className={cn("truncate", collapsed && "sr-only")}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-4 border-t border-border px-4 pt-4">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Your threads
          </p>
          <div className="mt-3 flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Sign in to keep your threads and vote on answers.
            </p>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-sidebar-accent"
            >
              Sign in
            </button>
          </div>
        </div>
      )}

      <div className="mt-auto flex shrink-0 items-center gap-2 px-4 py-4">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
          aria-hidden
        >
          <CircleUserRound className="h-4 w-4" />
        </span>
        <button
          type="button"
          aria-label="Toggle theme"
          title="Not built yet"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-sidebar-accent"
        >
          <Moon className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
