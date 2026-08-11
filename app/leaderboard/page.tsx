import { getOwnThreads } from "@/app/arena/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  LeaderboardTabs,
  type LeaderboardRowView,
} from "@/components/leaderboard/leaderboard-tabs";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { getLeaderboards, type LeaderboardRow } from "./leaderboard-data";

export default async function LeaderboardPage() {
  const [{ global, personal }, catalog, threads] = await Promise.all([
    getLeaderboards(),
    getFreeModelCatalog(),
    getOwnThreads(),
  ]);

  // Display names come from the live catalog; a model that has since left
  // the catalog keeps its raw id — history doesn't disappear.
  const withName = (row: LeaderboardRow): LeaderboardRowView => ({
    ...row,
    name:
      catalog.find((model) => model.id === row.modelId)?.name ?? row.modelId,
  });

  return (
    <AppShell breadcrumb="Leaderboard" threads={threads}>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-3xl font-medium">Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every model&apos;s real record, from actual head-to-head votes.
          </p>
        </div>

        <LeaderboardTabs
          global={global.map(withName)}
          personal={personal?.map(withName) ?? null}
        />
      </div>
    </AppShell>
  );
}
