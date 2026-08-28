"use client";

import { useState } from "react";
import type { ThreadListItem } from "@/app/arena/actions";
import { NewChatProvider } from "./new-chat-context";
import { Sidebar } from "./sidebar";
import { ThreadsProvider } from "./threads-context";
import { TopBar, type ModelBadge } from "./top-bar";

type AppShellProps = {
  breadcrumb: string;
  models?: ModelBadge[];
  threads?: ThreadListItem[];
  threadControls?: { threadId: string; initiallyShared: boolean };
  children: React.ReactNode;
};

export function AppShell({
  breadcrumb,
  models = [],
  threads = [],
  threadControls,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ThreadsProvider initialThreads={threads}>
      <NewChatProvider>
        <div className="flex h-dvh w-full overflow-hidden bg-background">
          <Sidebar collapsed={collapsed} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar
              breadcrumb={breadcrumb}
              models={models}
              threadControls={threadControls}
              onToggleSidebar={() => setCollapsed((value) => !value)}
            />
            <main className="relative flex-1 overflow-y-auto">
              <div className="surface-grid pointer-events-none absolute inset-0 opacity-45" />
              <div className="relative h-full">{children}</div>
            </main>
          </div>
        </div>
      </NewChatProvider>
    </ThreadsProvider>
  );
}
