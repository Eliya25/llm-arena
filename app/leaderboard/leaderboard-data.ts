import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { tallyLeaderboard, type LeaderboardRow } from "./tally";

export type { LeaderboardRow };

async function computeRows(clerkId: string | null): Promise<LeaderboardRow[]> {
  const turnWhere = clerkId ? { thread: { user: { clerkId } } } : {};

  const [votedTurns, metrics] = await Promise.all([
    prisma.turn.findMany({
      where: { ...turnWhere, vote: { isNot: null } },
      select: {
        vote: { select: { messageId: true } },
        messages: { select: { id: true, model: true } },
      },
    }),
    prisma.message.groupBy({
      by: ["model"],
      where: { status: "SUCCESS", turn: turnWhere },
      _avg: { tokensPerSecond: true, timeToFirstTokenMs: true },
    }),
  ]);

  return tallyLeaderboard(
    votedTurns.map((turn) => ({
      winnerMessageId: turn.vote?.messageId ?? null,
      messages: turn.messages,
    })),
    metrics.map((entry) => ({
      model: entry.model,
      tokensPerSecond: entry._avg.tokensPerSecond,
      timeToFirstTokenMs: entry._avg.timeToFirstTokenMs,
    })),
  );
}

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
