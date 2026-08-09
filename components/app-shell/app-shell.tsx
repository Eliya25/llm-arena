"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TopBar, type ModelBadge } from "./top-bar";

type AppShellProps = {
  breadcrumb: string;
  models?: ModelBadge[];
  children: React.ReactNode;
};

export function AppShell({ breadcrumb, models = [], children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar collapsed={collapsed} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          breadcrumb={breadcrumb}
          models={models}
          onToggleSidebar={() => setCollapsed((value) => !value)}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
