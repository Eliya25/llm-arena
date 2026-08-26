import { describe, expect, it } from "vitest";
import {
  VOTE_ALREADY_CAST,
  VOTE_NEEDS_TWO_ANSWERS,
  judgeVote,
  type VotableTurn,
} from "./vote-rules";

const answer = (id: string, status = "SUCCESS") => ({
  id,
  model: `model-${id}`,
  status,
});

const turn = (
  messages: { id: string; model: string; status: string }[],
  hasVote = false,
): VotableTurn => ({ messages, hasVote });

describe("judgeVote", () => {
  it("allows a winner once two models have answered", () => {
    const verdict = judgeVote(turn([answer("a"), answer("b")]), "a");

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.winner.id).toBe("a");
    expect(verdict.answered).toBe(2);
  });

  it("does not wait for a third lane that is still streaming", () => {
    // The rule that makes voting feel immediate: two finished answers are a
    // comparison, whatever the third is doing.
    const verdict = judgeVote(
      turn([answer("a"), answer("b"), answer("c", "STREAMING")]),
      "b",
    );

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.answered).toBe(2);
  });

  it("refuses when only one model answered", () => {
    // One answer compared against nothing is not a comparison.
    const verdict = judgeVote(turn([answer("a"), answer("b", "FAILED")]), "a");

    expect(verdict).toEqual({ ok: false, error: VOTE_NEEDS_TWO_ANSWERS });
  });

  it("refuses a winner that did not succeed", () => {
    const verdict = judgeVote(
      turn([answer("a", "FAILED"), answer("b"), answer("c")]),
      "a",
    );

    expect(verdict).toEqual({ ok: false, error: VOTE_NEEDS_TWO_ANSWERS });
  });

  it("refuses a winner that is not in this turn at all", () => {
    const verdict = judgeVote(
      turn([answer("a"), answer("b")]),
      "from-a-different-turn",
    );

    expect(verdict.ok).toBe(false);
  });

  it("refuses a lane the server has not finished writing", () => {
    // A lane can look done on screen a moment before its row is written. The
    // rules are checked against the row, not the screen.
    const verdict = judgeVote(
      turn([answer("a", "STREAMING"), answer("b"), answer("c")]),
      "a",
    );

    expect(verdict.ok).toBe(false);
  });

  it("refuses a second vote", () => {
    const verdict = judgeVote(turn([answer("a"), answer("b")], true), "a");

    expect(verdict).toEqual({ ok: false, error: VOTE_ALREADY_CAST });
  });

  it("says the turn is already decided before anything else", () => {
    // A voted turn gets the accurate message even when the vote would have
    // been refused for another reason too.
    const verdict = judgeVote(turn([answer("a")], true), "a");

    expect(verdict).toEqual({ ok: false, error: VOTE_ALREADY_CAST });
  });

  it("refuses a turn where nothing answered", () => {
    expect(judgeVote(turn([]), "a").ok).toBe(false);
    expect(
      judgeVote(turn([answer("a", "PENDING"), answer("b", "FAILED")]), "a").ok,
    ).toBe(false);
  });

  it("counts only successes, however many lanes there were", () => {
    const verdict = judgeVote(
      turn([
        answer("a"),
        answer("b"),
        answer("c"),
        answer("d", "FAILED"),
        answer("e", "PENDING"),
      ]),
      "c",
    );

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.answered).toBe(3);
  });

  it("gives the same refusal for a bad winner and for too few answers", () => {
    // Deliberate: from the voter's side both mean "the answers are not all in
    // yet", and distinguishing them would only describe the database back.
    const badWinner = judgeVote(
      turn([answer("a", "FAILED"), answer("b"), answer("c")]),
      "a",
    );
    const tooFew = judgeVote(turn([answer("b")]), "b");

    expect(badWinner).toEqual(tooFew);
  });
});
