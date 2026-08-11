"use client";

import { useState } from "react";
import type { ThreadListItem } from "@/app/arena/actions";
import { Sidebar } from "./sidebar";
import { ThreadsProvider } from "./threads-context";
import { TopBar, type ModelBadge } from "./top-bar";

type AppShellProps = {
  breadcrumb: string;
  models?: ModelBadge[];
  threads?: ThreadListItem[];
  showCopyLink?: boolean;
  children: React.ReactNode;
};

export function AppShell({
  breadcrumb,
  models = [],
  threads = [],
  showCopyLink = false,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ThreadsProvider initialThreads={threads}>
      <div className="flex h-dvh w-full overflow-hidden">
        <Sidebar collapsed={collapsed} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            breadcrumb={breadcrumb}
            models={models}
            showCopyLink={showCopyLink}
            onToggleSidebar={() => setCollapsed((value) => !value)}
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ThreadsProvider>
  );
}
