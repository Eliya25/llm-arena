// Whether a vote is allowed, separated from casting it. Pure, so the rule can
// be read and checked without a signed-in session and a rate limiter standing
// in front of it — which is exactly why it had no automated coverage until
// now (docs/scope-v2.md Feature 5 recorded the debt, Feature 2 pays it).
//
// Ownership is not decided here. That is settled by the query that loads the
// turn, scoped through the relation chain to the caller, and a rule object
// cannot be trusted to remember it.

export type VotableMessage = {
  readonly id: string;
  readonly model: string;
  readonly status: string;
};

export type VotableTurn = {
  readonly messages: readonly VotableMessage[];
  // Present once this turn already has a winner.
  readonly hasVote: boolean;
};

export type VoteVerdict =
  | {
      readonly ok: true;
      readonly winner: VotableMessage;
      // How many models actually answered — carried out because the funnel
      // event reports it, and recounting it elsewhere invites disagreement.
      readonly answered: number;
    }
  | { readonly ok: false; readonly error: string };

// The rule: a vote only exists once two or more models actually answered.
// Comparing one answer against nothing is not a comparison.
export const MIN_ANSWERS_TO_VOTE = 2;

export const VOTE_ALREADY_CAST = "This turn already has a winner.";
export const VOTE_NEEDS_TWO_ANSWERS =
  "A vote needs at least two finished answers.";

export function judgeVote(turn: VotableTurn, messageId: string): VoteVerdict {
  if (turn.hasVote) {
    return { ok: false, error: VOTE_ALREADY_CAST };
  }

  const answered = turn.messages.filter(
    (message) => message.status === "SUCCESS",
  );
  const winner = answered.find((message) => message.id === messageId);

  // One message covers both refusals on purpose. A winner that did not
  // succeed and a turn without enough answers are the same situation from the
  // voter's side — the answers are not all in yet — and naming which is which
  // would only describe the database back to them.
  if (!winner || answered.length < MIN_ANSWERS_TO_VOTE) {
    return { ok: false, error: VOTE_NEEDS_TWO_ANSWERS };
  }

  return { ok: true, winner, answered: answered.length };
}
