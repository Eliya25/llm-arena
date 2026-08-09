import { AppShell } from "@/components/app-shell/app-shell";
import { cn } from "@/lib/utils";

type LeaderboardRow = {
  rank: number;
  initial: string;
  name: string;
  wins: number;
  total: number;
  avgTimeToFirstTokenMs: number;
  avgTokensPerSecond: number;
};

const PLACEHOLDER_ROWS: LeaderboardRow[] = [
  {
    rank: 1,
    initial: "N",
    name: "NVIDIA: Nemotron 3 Ultra",
    wins: 507,
    total: 700,
    avgTimeToFirstTokenMs: 1186,
    avgTokensPerSecond: 57,
  },
  {
    rank: 2,
    initial: "Q",
    name: "Qwen 3 Coder",
    wins: 398,
    total: 640,
    avgTimeToFirstTokenMs: 942,
    avgTokensPerSecond: 63,
  },
  {
    rank: 3,
    initial: "P",
    name: "Phi 4 Reasoning",
    wins: 251,
    total: 590,
    avgTimeToFirstTokenMs: 1420,
    avgTokensPerSecond: 41,
  },
];

export default function LeaderboardPage() {
  return (
    <AppShell breadcrumb="Leaderboard">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-3xl font-medium">Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every model&apos;s real record, from actual head-to-head votes.
          </p>
        </div>

        <div
          className="inline-flex w-fit gap-1 rounded-md border border-border bg-secondary p-1"
          role="group"
          aria-label="Leaderboard scope"
        >
          <button
            type="button"
            className="rounded bg-card px-3 py-1.5 text-sm font-medium text-foreground"
          >
            Global
          </button>
          <button
            type="button"
            title="Not built yet"
            className="rounded px-3 py-1.5 text-sm font-medium text-muted-foreground"
          >
            Personal
          </button>
        </div>

        <div>
          <h2 className="text-lg font-medium">Global ranking</h2>
          <p className="text-sm text-muted-foreground">
            Every vote, every user, ranked by real wins.
          </p>

          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground uppercase">
                  <th className="w-12 px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Win record</th>
                  <th className="px-4 py-3 font-medium">Avg. to first token</th>
                  <th className="px-4 py-3 font-medium">Avg. tokens/sec</th>
                </tr>
              </thead>
              <tbody>
                {PLACEHOLDER_ROWS.map((row) => (
                  <tr
                    key={row.name}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      row.rank === 1 && "bg-accent/40",
                    )}
                  >
                    <td className="px-4 py-4 font-mono text-muted-foreground">
                      {row.rank}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs">
                          {row.initial}
                        </span>
                        <span className="font-medium">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="font-display text-xl leading-none font-semibold text-primary">
                          Won {row.wins} of {row.total}
                        </span>
                        <span
                          className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
                          role="img"
                          aria-label={`Won ${row.wins} of ${row.total}`}
                        >
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{
                              width: `${(row.wins / row.total) * 100}%`,
                            }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                      {row.avgTimeToFirstTokenMs}ms
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                      {row.avgTokensPerSecond} tok/s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
