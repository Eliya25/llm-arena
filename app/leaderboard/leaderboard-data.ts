import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export type LeaderboardRow = {
  modelId: string;
  // Voted turns this model won / participated in — the same definition the
  // thread page's badges use, so the numbers agree everywhere.
  wins: number;
  total: number;
  // Averages over every SUCCESS answer (scoped to the owner for personal),
  // each one a stored real measurement; null when nothing was measured.
  avgTokensPerSecond: number | null;
  avgTimeToFirstTokenMs: number | null;
};

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

  // One record per model per voted turn. Flattening first turns the tally into
  // a plain read over a list, instead of a nested loop mutating a shared map.
  const participations = votedTurns.flatMap((turn) => {
    const winnerModel = turn.messages.find(
      (message) => message.id === turn.vote?.messageId,
    )?.model;
    // Deduplicated, so a model that somehow answered one turn twice still
    // counts as a single participation in it.
    const models = [...new Set(turn.messages.map((message) => message.model))];
    return models.map((model) => ({ model, won: model === winnerModel }));
  });

  const averages = new Map(metrics.map((entry) => [entry.model, entry._avg]));

  // Counted by filtering per model rather than folding into a mutable
  // accumulator. That's a pass per model instead of one pass total, which is
  // the right trade here: votes are the scarce data (see the query above), and
  // the wins/total rule stays readable as the definition it is.
  return [...new Set(participations.map((entry) => entry.model))]
    .map((modelId) => {
      const forModel = participations.filter(
        (entry) => entry.model === modelId,
      );
      const avg = averages.get(modelId);
      return {
        modelId,
        wins: forModel.filter((entry) => entry.won).length,
        total: forModel.length,
        avgTokensPerSecond:
          avg?.tokensPerSecond != null ? Math.round(avg.tokensPerSecond) : null,
        avgTimeToFirstTokenMs:
          avg?.timeToFirstTokenMs != null
            ? Math.round(avg.timeToFirstTokenMs)
            : null,
      };
    })
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.wins / b.total - a.wins / a.total ||
        a.modelId.localeCompare(b.modelId),
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
