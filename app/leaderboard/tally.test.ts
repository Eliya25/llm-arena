import { describe, expect, it } from "vitest";
import { tallyLeaderboard, type VotedTurn } from "./tally";

const turn = (winner: string | null, models: string[]): VotedTurn => ({
  winnerMessageId: winner,
  messages: models.map((model) => ({ id: `msg-${model}`, model })),
});

// A turn where "a" won, out of a, b, c.
const aWins = () => turn("msg-a", ["a", "b", "c"]);

describe("tallyLeaderboard", () => {
  it("counts a win for the winner and a participation for everyone", () => {
    const rows = tallyLeaderboard([aWins()], []);

    expect(rows).toEqual([
      expect.objectContaining({ modelId: "a", wins: 1, total: 1 }),
      expect.objectContaining({ modelId: "b", wins: 0, total: 1 }),
      expect.objectContaining({ modelId: "c", wins: 0, total: 1 }),
    ]);
  });

  it("only counts models that were actually in the turn", () => {
    const rows = tallyLeaderboard([turn("msg-a", ["a", "b"])], []);
    expect(rows.map((row) => row.modelId)).toEqual(["a", "b"]);
  });

  it("counts a model that answered one turn twice as one participation", () => {
    const rows = tallyLeaderboard([turn("msg-a", ["a", "a", "b"])], []);
    expect(rows.find((row) => row.modelId === "a")).toMatchObject({
      wins: 1,
      total: 1,
    });
  });

  it("ranks by wins, then by win rate, then by name", () => {
    const rows = tallyLeaderboard(
      [
        // a: 2 wins from 3. b: 2 wins from 4. c: 0 from 1.
        turn("msg-a", ["a", "b"]),
        turn("msg-a", ["a", "b"]),
        turn("msg-b", ["a", "b"]),
        turn("msg-b", ["b", "c"]),
      ],
      [],
    );

    expect(rows.map((row) => row.modelId)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ wins: 2, total: 3 });
    expect(rows[1]).toMatchObject({ wins: 2, total: 4 });
  });

  it("breaks a dead heat on the model name, so the order never wobbles", () => {
    const rows = tallyLeaderboard(
      [
        turn("msg-zeta", ["zeta", "alpha"]),
        turn("msg-alpha", ["zeta", "alpha"]),
      ],
      [],
    );
    // Identical records: 1 win from 2 each. Name decides, and decides the same
    // way on every render.
    expect(rows.map((row) => row.modelId)).toEqual(["alpha", "zeta"]);
  });

  it("attaches averages and rounds them", () => {
    const rows = tallyLeaderboard(
      [turn("msg-a", ["a"])],
      [{ model: "a", tokensPerSecond: 41.6, timeToFirstTokenMs: 812.4 }],
    );

    expect(rows[0]).toMatchObject({
      avgTokensPerSecond: 42,
      avgTimeToFirstTokenMs: 812,
    });
  });

  it("reports no measurement rather than a zero", () => {
    // A model with votes but no stored metrics must not be published as the
    // slowest model in the arena.
    const rows = tallyLeaderboard([turn("msg-a", ["a"])], []);
    expect(rows[0].avgTokensPerSecond).toBeNull();
    expect(rows[0].avgTimeToFirstTokenMs).toBeNull();
  });

  it("ignores averages for models nobody voted on", () => {
    const rows = tallyLeaderboard(
      [turn("msg-a", ["a"])],
      [
        { model: "a", tokensPerSecond: 10, timeToFirstTokenMs: 100 },
        { model: "never-voted", tokensPerSecond: 999, timeToFirstTokenMs: 1 },
      ],
    );
    expect(rows.map((row) => row.modelId)).toEqual(["a"]);
  });

  it("is empty when nothing has been voted on", () => {
    expect(tallyLeaderboard([], [])).toEqual([]);
  });

  it("survives a vote pointing at a message that is not in the turn", () => {
    // Defensive: every model still counts as having participated, and the turn
    // simply has no winner rather than throwing.
    const rows = tallyLeaderboard([turn("msg-missing", ["a", "b"])], []);
    expect(rows.every((row) => row.wins === 0)).toBe(true);
    expect(rows.every((row) => row.total === 1)).toBe(true);
  });
});
