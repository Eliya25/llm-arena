import { AppShell } from "@/components/app-shell/app-shell";
import { ArenaClient } from "@/components/arena/arena-client";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { getOwnThreads } from "./actions";

export default async function ArenaPage() {
  const [catalog, threads] = await Promise.all([
    getFreeModelCatalog(),
    getOwnThreads(),
  ]);

  return (
    <AppShell breadcrumb="Arena" threads={threads}>
      <ArenaClient catalog={catalog} />
    </AppShell>
  );
}
