// Reading an SSE stream, with no side effects and nothing to mock: given the
// same bytes and the same arrival times these always produce the same answer.
// Split out of record-answer.ts so the parsing and measurement rules can be
// exercised without a database anywhere near them.

type StreamChunk = {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

// Everything the stream has said so far. Read-only: each arriving chunk
// produces a new one rather than editing this in place.
export type Reading = {
  readonly content: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly firstTokenAt: number | null;
  readonly lastTokenAt: number | null;
};

// What one arrival from upstream turned out to be, or that the checkpoint
// interval came due first. The loop waits on both at once, so its own clock
// keeps running through a silence the model never breaks.
// A chunk carries the moment it landed, stamped the instant the read resolved
// rather than whenever the loop gets round to folding it in. Those are not the
// same instant any more: a checkpoint can come due while a chunk is already
// waiting, and the database write that follows would otherwise be charged to
// the model as generation time.
export type Arrival =
  | { readonly kind: "chunk"; readonly value: Uint8Array; readonly at: number }
  | { readonly kind: "end" }
  | { readonly kind: "due" };

// The reading plus what the read loop itself carries between chunks: the tail
// of a line that arrived split across a network boundary, when the last
// checkpoint ran, and the read that is currently outstanding — held rather than
// re-issued, because a checkpoint coming due must not consume or discard the
// chunk the stream is still in the middle of delivering.
//
// Kept as one value so the loop advances a single cursor built by pure
// functions, rather than juggling separate mutable bindings across awaits.
export type Cursor = {
  readonly reading: Reading;
  readonly buffer: string;
  readonly checkpointedAt: number;
  readonly pending: Promise<Arrival>;
};

// How the read ended — returned, rather than tracked in a flag the rest of the
// function reassigns. "complete" is a clean upstream finish, "interrupted" is
// one that died mid-read, and "superseded" means a retry claimed the row while
// this attempt was still streaming, so nothing measured here belongs to the
// answer any more.
export type ReadOutcome = "complete" | "interrupted" | "superseded";

export const BLANK_READING: Reading = {
  content: "",
  inputTokens: null,
  outputTokens: null,
  firstTokenAt: null,
  lastTokenAt: null,
};

// Only the metrics whose definitions are pinned in prisma/schema.prisma. A
// value upstream never reported stays null — never estimated, never zeroed.
export function measure(reading: Reading, upstreamAt: number) {
  const { firstTokenAt, lastTokenAt, outputTokens } = reading;
  const timeToFirstTokenMs =
    firstTokenAt !== null ? Math.round(firstTokenAt - upstreamAt) : null;
  const generationDurationMs =
    firstTokenAt !== null && lastTokenAt !== null
      ? Math.round(lastTokenAt - firstTokenAt)
      : null;
  // Deliberately the whole window, not just the streaming part. A model that
  // spends tokens on reasoning produces them *during* the wait for the first
  // visible token, so dividing every reported token by the streaming window
  // alone reported 3152 tok/s for 49 characters of Hebrew — a real row this
  // app wrote, and a number the leaderboard would have ranked on.
  const tokensPerSecond =
    outputTokens !== null && lastTokenAt !== null && lastTokenAt > upstreamAt
      ? outputTokens / ((lastTokenAt - upstreamAt) / 1000)
      : null;
  return { timeToFirstTokenMs, generationDurationMs, tokensPerSecond };
}

function parseChunk(payload: string): StreamChunk | null {
  try {
    return JSON.parse(payload) as StreamChunk;
  } catch {
    // Not JSON — a comment or keep-alive line. Skip it.
    return null;
  }
}

// One SSE line folded into the reading. Pure: same line, same reading, same
// answer, which is what makes the parsing rules readable on their own.
// `arrivedAt` is the moment its chunk was read, passed in rather than measured
// here so the clock stays at the edge.
export function absorbLine(
  reading: Reading,
  line: string,
  arrivedAt: number,
): Reading {
  if (!line.startsWith("data: ")) return reading;
  const payload = line.slice(6).trim();
  if (payload === "" || payload === "[DONE]") return reading;
  const chunk = parseChunk(payload);
  if (!chunk) return reading;

  const delta = chunk.choices?.[0]?.delta?.content;
  const withText =
    typeof delta === "string" && delta.length > 0
      ? {
          ...reading,
          content: reading.content + delta,
          firstTokenAt: reading.firstTokenAt ?? arrivedAt,
          lastTokenAt: arrivedAt,
        }
      : reading;

  // ?? rather than ||, so a genuine zero from upstream is kept as a zero.
  return {
    ...withText,
    inputTokens: chunk.usage?.prompt_tokens ?? withText.inputTokens,
    outputTokens: chunk.usage?.completion_tokens ?? withText.outputTokens,
  };
}

// One decoded chunk folded into the cursor. Whatever follows the last newline
// is not a whole line yet and is carried forward to be completed by the chunk
// after it.
export function absorb(
  cursor: Cursor,
  text: string,
  arrivedAt: number,
): Cursor {
  const lines = (cursor.buffer + text).split("\n");
  const buffer = lines.pop() ?? "";
  return {
    ...cursor,
    buffer,
    reading: lines.reduce(
      (reading, line) => absorbLine(reading, line, arrivedAt),
      cursor.reading,
    ),
  };
}
