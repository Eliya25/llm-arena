// The counting rule behind the leaderboard, separated from the query that
// feeds it. Pure, so the definition of a win can be read and checked on its
// own — which matters, because this is the number the whole product exists to
// produce and it has no visual representation until it is already wrong.

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

// One voted turn, as the tally needs it: who answered, and which answer won.
export type VotedTurn = {
  readonly winnerMessageId: string | null;
  readonly messages: readonly { readonly id: string; readonly model: string }[];
};

export type ModelAverages = {
  readonly model: string;
  readonly tokensPerSecond: number | null;
  readonly timeToFirstTokenMs: number | null;
};

const round = (value: number | null | undefined) =>
  value != null ? Math.round(value) : null;

export function tallyLeaderboard(
  votedTurns: readonly VotedTurn[],
  averages: readonly ModelAverages[],
): LeaderboardRow[] {
  // One record per model per voted turn. Flattening first turns the tally into
  // a plain read over a list, instead of a nested loop mutating a shared map.
  const participations = votedTurns.flatMap((turn) => {
    const winnerModel = turn.messages.find(
      (message) => message.id === turn.winnerMessageId,
    )?.model;
    // Deduplicated, so a model that somehow answered one turn twice still
    // counts as a single participation in it.
    const models = [...new Set(turn.messages.map((message) => message.model))];
    return models.map((model) => ({ model, won: model === winnerModel }));
  });

  const averageFor = new Map(averages.map((entry) => [entry.model, entry]));

  // Counted by filtering per model rather than folding into a mutable
  // accumulator. That's a pass per model instead of one pass total, which is
  // the right trade here: votes are the scarce data, and the wins/total rule
  // stays readable as the definition it is.
  return [...new Set(participations.map((entry) => entry.model))]
    .map((modelId) => {
      const forModel = participations.filter(
        (entry) => entry.model === modelId,
      );
      const average = averageFor.get(modelId);
      return {
        modelId,
        wins: forModel.filter((entry) => entry.won).length,
        total: forModel.length,
        avgTokensPerSecond: round(average?.tokensPerSecond),
        avgTimeToFirstTokenMs: round(average?.timeToFirstTokenMs),
      };
    })
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.wins / b.total - a.wins / a.total ||
        a.modelId.localeCompare(b.modelId),
    );
}
