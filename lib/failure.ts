// What can go wrong, named once (docs/scope-v2.md Feature 3).
//
// The sentences a person reads used to be string literals at each call site,
// which is why some of them were good and some described the database back.
// Keeping them here means a failure is classified before it is worded, and the
// wording is reviewable as a set rather than one line at a time.
//
// Nothing here is retried automatically except where `retryable` says so, and
// what that permits is deliberately narrow — see callUpstream in
// app/api/chat/route.ts.

export type FailureKind =
  // The request itself is wrong. Retrying it unchanged is pointless.
  | "invalid_request"
  // We cannot establish who is asking.
  | "unauthenticated"
  // Too much, too fast, from this person.
  | "rate_limited"
  // A security rule said no: injection, a card number, a bot signature.
  | "security_denied"
  // The model answered, and the answer was "I am full".
  | "upstream_busy"
  // The provider is broken or unreachable.
  | "upstream_unavailable"
  // The provider went quiet for longer than we are willing to wait.
  | "upstream_timeout"
  // We could not fetch the list of models, so we cannot vouch for any of them.
  | "catalog_unavailable"
  // A real model id, but not one this app offers.
  | "model_not_allowed"
  // Our own storage.
  | "database"
  // Anything we did not anticipate.
  | "internal";

export type Failure = {
  readonly kind: FailureKind;
  // The sentence a person sees. Plain, and never an exception or a provider
  // string (CLAUDE.md).
  readonly message: string;
  readonly status: number;
  // Whether trying the identical operation again could plausibly work. It
  // describes the failure, not a promise that anything will retry.
  readonly retryable: boolean;
};

const FAILURES: Record<FailureKind, Omit<Failure, "kind">> = {
  invalid_request: {
    message: "This request couldn't be read. Please try again.",
    status: 400,
    retryable: false,
  },
  unauthenticated: {
    message: "Please sign in to send a prompt.",
    status: 401,
    retryable: false,
  },
  rate_limited: {
    message: "You're sending requests too quickly. Please slow down.",
    status: 429,
    retryable: true,
  },
  security_denied: {
    message: "Your request couldn't be processed. Please try again.",
    status: 403,
    retryable: false,
  },
  upstream_busy: {
    // Free models share a provider pool, so this is the most common way a lane
    // fails here. Saying "didn't respond" would send someone off debugging
    // their own prompt instead of waiting or picking another model.
    message:
      "This model is busy right now. Try again in a moment, or pick a different one.",
    status: 429,
    retryable: true,
  },
  upstream_unavailable: {
    message: "The model didn't respond. Please try again.",
    status: 502,
    retryable: true,
  },
  upstream_timeout: {
    message: "The model took too long to respond. Please try again.",
    status: 504,
    retryable: true,
  },
  catalog_unavailable: {
    // Distinct from model_not_allowed on purpose: telling someone to pick from
    // a list that an outage just emptied is a maze with no exit.
    message:
      "The model list can't be loaded right now, so prompts are paused. Please try again shortly.",
    status: 503,
    retryable: true,
  },
  model_not_allowed: {
    message: "That model isn't available here. Pick one from the model list.",
    status: 400,
    retryable: false,
  },
  database: {
    message: "Something went wrong saving this. Please try again.",
    status: 500,
    retryable: true,
  },
  internal: {
    message: "Something went wrong. Please try again.",
    status: 500,
    retryable: false,
  },
};

export function failure(kind: FailureKind): Failure {
  return { kind, ...FAILURES[kind] };
}

// How an upstream HTTP status maps onto the taxonomy. Anything that is not
// recognisably the provider's own answer is treated as the provider being
// unavailable, which is the honest reading: we did not get a response we can
// interpret.
export function classifyUpstream(status: number): Failure {
  if (status === 429) return failure("upstream_busy");
  if (status === 408 || status === 504) return failure("upstream_timeout");
  return failure("upstream_unavailable");
}

// Whether a failed upstream call is worth one more attempt. Deliberately not
// "is this a 5xx": a 429 is the provider answering clearly, and asking again
// immediately only burns the same quota to be told the same thing.
export function worthRetrying(status: number): boolean {
  return status >= 500 || status === 408;
}

export function asResponse(failed: Failure): Response {
  return Response.json({ error: failed.message }, { status: failed.status });
}
