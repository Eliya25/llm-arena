import { auth } from "@clerk/nextjs/server";
import { computeRows, type LeaderboardRow } from "./leaderboard-query";

export type { LeaderboardRow };

// Both boards come from the same votes: global is everyone's, personal is the
// signed-in user's own threads only (null when signed out). Database failures
// throw and land on the app's plain error boundary rather than rendering an
// empty board that would falsely read as "no votes yet".
export async function getLeaderboards(): Promise<{
  global: LeaderboardRow[];
  personal: LeaderboardRow[] | null;
}> {
  const { userId } = await auth();
  const [global, personal] = await Promise.all([
    computeRows(null),
    userId ? computeRows(userId) : Promise.resolve(null),
  ]);
  return { global, personal };
}
