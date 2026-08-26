// Structured events, so one generation can be followed across the components
// that touch it (docs/scope-v2.md Feature 4).
//
// What existed before was twenty-four console.error sites, each a message
// string plus an ad-hoc object whose keys differed everywhere. Enough to see
// that something failed, never enough to join two lines about the same answer.
//
// `console` is still the transport. The host already collects stdout, and a
// log vendor on a project this size is the logo-on-the-stack the scope warns
// against. What changed is the shape.

// The identifiers that make two lines about the same answer joinable. Every
// one of them already existed in the code; they were simply not on the logs.
export type Correlation = {
  // Ties together everything one HTTP request did, including the lines emitted
  // before a row exists — the security decision, the catalog check, a refused
  // request. The only identifier here that had to be invented.
  readonly requestId: string;
  readonly userId?: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly messageId?: string;
  readonly model?: string;
  readonly attempt?: number;
};

// Deliberately not `unknown`: an object would let a whole prompt, a whole
// answer, or a config holding a key be dumped in one careless spread.
type Detail = string | number | boolean | null | undefined;

export type Details = Record<string, Detail>;

// Long enough for a provider's error message, far too short for an answer.
const MAX_DETAIL_LENGTH = 200;

// Redaction as a property of the logger rather than a habit of its callers.
// Content is the thing that must not be here: prompts, answers, keys. A length
// is a useful fact about a string, so that is what a long one becomes.
function redact(details: Details): Details {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) =>
        typeof value === "string" && value.length > MAX_DETAIL_LENGTH
          ? [key, `[${value.length} chars]`]
          : [key, value],
      ),
  );
}

type Level = "info" | "warn" | "error";

function emit(
  level: Level,
  event: string,
  correlation: Correlation,
  details: Details,
) {
  const line = {
    at: new Date().toISOString(),
    level,
    event,
    ...redact({ ...correlation }),
    ...redact(details),
  };

  // Readable while someone is watching a dev server; one JSON object per line
  // everywhere else, which is what makes a log searchable.
  const text =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(line)
      : `${event} ${Object.entries(line)
          .filter(([key]) => key !== "event" && key !== "at" && key !== "level")
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ")}`;

  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  info: (event: string, correlation: Correlation, details: Details = {}) =>
    emit("info", event, correlation, details),
  warn: (event: string, correlation: Correlation, details: Details = {}) =>
    emit("warn", event, correlation, details),
  error: (event: string, correlation: Correlation, details: Details = {}) =>
    emit("error", event, correlation, details),
};

// One per HTTP request. Nothing depends on the format beyond being unique and
// quotable by someone reporting a problem.
export const newRequestId = () => crypto.randomUUID();

// What a caught value can safely contribute to a log line. An Error's message
// is useful and bounded; anything else is described rather than dumped, since
// a thrown object can carry a request body or a connection string.
export function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return typeof cause;
}
