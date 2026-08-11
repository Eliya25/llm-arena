"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Boxes,
  CircleUserRound,
  Moon,
  Sun,
  Swords,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useThreads } from "./threads-context";

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

const emptySubscribe = () => () => {};

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The resolved theme is unknown until the client mounts; rendering the wrong
  // icon on the server would cause a hydration mismatch.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      // The label must not depend on the theme until the client has mounted —
      // the server doesn't know the resolved theme, and a mismatched attribute
      // fails hydration.
      aria-label={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Toggle theme"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-sidebar-accent"
    >
      {mounted && isDark ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const { isSignedIn } = useUser();
  const { threads } = useThreads();

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
        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border px-4 pt-4">
          <p className="shrink-0 font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Your threads
          </p>
          <div className="mt-3 flex min-h-0 flex-col items-start gap-3 overflow-y-auto">
            {isSignedIn ? (
              threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No threads yet. Send your first prompt in the arena.
                </p>
              ) : (
                <nav
                  className="flex w-full flex-col gap-0.5"
                  aria-label="Your threads"
                >
                  {threads.map((thread) => {
                    const href = `/arena/${thread.id}`;
                    const active = pathname === href;

                    return (
                      <Link
                        key={thread.id}
                        href={href}
                        title={thread.title}
                        className={cn(
                          "truncate rounded-md px-3 py-1.5 text-sm",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/50",
                        )}
                      >
                        {thread.title}
                      </Link>
                    );
                  })}
                </nav>
              )
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Sign in to keep your threads and vote on answers.
                </p>
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-sidebar-accent"
                  >
                    Sign in
                  </button>
                </SignInButton>
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-auto flex shrink-0 items-center gap-2 px-4 py-4">
        {isSignedIn ? (
          <UserButton />
        ) : (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
            aria-hidden
          >
            <CircleUserRound className="h-4 w-4" />
          </span>
        )}
        <ThemeToggle />
      </div>
    </aside>
  );
}
