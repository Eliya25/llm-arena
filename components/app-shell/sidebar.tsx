"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Boxes,
  CircleUserRound,
  Command,
  Moon,
  Plus,
  Sun,
  Swords,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNewChat } from "./new-chat-context";
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

// Shared row geometry for the sidebar's nav items and the New chat action, so
// their icons and labels line up on one grid instead of drifting apart.
const SIDEBAR_ROW =
  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors";

const emptySubscribe = () => () => {};

// Starting over is a reset, not the app's main move — so it carries the rust
// accent as an outline rather than a fill, staying clearly interactive without
// competing with Send or "Pick as winner", the two filled-rust actions.
function NewChatButton({ collapsed }: { collapsed: boolean }) {
  const { resetRef } = useNewChat();

  return (
    <Link
      href="/arena"
      title="New chat"
      onClick={(event) => {
        // Let the browser handle modified clicks (new tab, new window).
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        const reset = resetRef.current;
        // No arena mounted to clear — navigate like any other link.
        if (!reset) return;
        event.preventDefault();
        reset();
        // The address bar may still read /arena/<id> from the first send.
        window.history.replaceState(null, "", "/arena");
      }}
      className={cn(
        SIDEBAR_ROW,
        "soft-shadow mx-2 mb-4 border border-primary/70 bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
        !collapsed && "justify-between",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-foreground/12">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </span>
        <span className={cn("truncate max-md:hidden", collapsed && "sr-only")}>
          New chat
        </span>
      </span>
      {!collapsed && (
        <span className="hidden items-center gap-0.5 rounded border border-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px] opacity-65 md:flex">
          <Command className="h-2.5 w-2.5" aria-hidden /> K
        </span>
      )}
    </Link>
  );
}

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
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur transition-[width] duration-200",
        collapsed ? "w-16" : "w-16 md:w-64",
      )}
    >
      <div className="flex h-16 shrink-0 items-center px-4">
        <span className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 font-display text-sm text-primary">
          A
        </span>
        <span
          className={cn(
            "truncate font-display text-lg font-semibold tracking-[-0.02em] max-md:hidden",
            collapsed && "sr-only",
          )}
        >
          LLM Arena
        </span>
      </div>

      <NewChatButton collapsed={collapsed} />

      <nav className="flex flex-col gap-1 px-2" aria-label="Main">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          const active = pathname === href;

          return (
            <Link
              key={label}
              href={href}
              className={cn(
                SIDEBAR_ROW,
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground before:h-4 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span
                className={cn("truncate max-md:hidden", collapsed && "sr-only")}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-4 hidden min-h-0 flex-1 flex-col border-t border-border/70 px-4 pt-5 md:flex">
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
