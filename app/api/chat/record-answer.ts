import { prisma } from "@/lib/prisma";
import { getPostHogClient } from "@/lib/posthog-server";

// How often the accumulated answer is written down mid-stream. Time-based, not
// per-token: a three-minute answer that dies at the 99% mark used to persist an
// empty string, and one write per token would be absurd in the other direction.
const CHECKPOINT_MS = 2_000;

// The authoritative outcome of one generation: exactly what was written to the
// row, handed back so the route can tell the browser what it stored. The
// browser displays these; it never supplies them.
export type AnswerResult = {
  status: "SUCCESS" | "FAILED";
  timeToFirstTokenMs: number | null;
  generationDurationMs: number | null;
  tokensPerSecond: number | null;
  outputTokens: number | null;
};

type StreamChunk = {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type Reading = {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  firstTokenAt: number | null;
  lastTokenAt: number | null;
  complete: boolean;
};

// Only the metrics whose definitions are pinned in prisma/schema.prisma. A
// value upstream never reported stays null — never estimated, never zeroed.
function measure(reading: Reading, upstreamAt: number) {
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

// Reads the server's own copy of the upstream stream — the only place in the
// app that actually sees what the model said — and writes it down as it goes.
//
// This runs off a tee() branch rather than a transform in the browser's path,
// and the route hands it to after(), so a closed tab does not end the read:
// walking away from a live answer still saves the answer.
export async function recordAnswer(
  branch: ReadableStream<Uint8Array>,
  details: {
    messageId: string;
    // The try this recorder owns. Every write it makes is conditioned on it,
    // so once a retry has claimed the row this recorder writes nothing.
    attempt: number;
    model: string;
    distinctId: string;
    upstreamAt: number;
    // Called on every chunk that arrives, so the route's stall watchdog can
    // tell a slow model from a dead one.
    onProgress: (hasFirstToken: boolean) => void;
  },
): Promise<AnswerResult | null> {
  const reading: Reading = {
    content: "",
    inputTokens: null,
    outputTokens: null,
    firstTokenAt: null,
    lastTokenAt: null,
    complete: false,
  };

  // Set once a write finds the row has moved on to a later attempt: a retry
  // owns this answer now, and everything measured here belongs to a try the
  // user already replaced. The honest thing is to stop, not to publish it.
  let superseded = false;

  // Checkpoints are best-effort: a failed intermediate write must not abandon
  // a stream that is still arriving, since the final write may well succeed.
  let checkpointedAt = 0;
  const checkpoint = async () => {
    checkpointedAt = performance.now();
    try {
      const written = await prisma.message.updateMany({
        where: { id: details.messageId, attempt: details.attempt },
        data: { content: reading.content, status: "STREAMING" },
      });
      if (written.count === 0) superseded = true;
    } catch (cause) {
      console.error("Checkpointing an answer failed", {
        messageId: details.messageId,
        attempt: details.attempt,
        cause,
      });
    }
  };

  try {
    const reader = branch.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "" || payload === "[DONE]") continue;
        const chunk = parseChunk(payload);
        if (!chunk) continue;

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          const now = performance.now();
          if (reading.firstTokenAt === null) reading.firstTokenAt = now;
          reading.lastTokenAt = now;
          reading.content += delta;
        }
        if (typeof chunk.usage?.prompt_tokens === "number") {
          reading.inputTokens = chunk.usage.prompt_tokens;
        }
        if (typeof chunk.usage?.completion_tokens === "number") {
          reading.outputTokens = chunk.usage.completion_tokens;
        }
      }

      // Reported after the chunk is parsed, not before: the chunk carrying the
      // first token would otherwise still say there was no token yet, leaving
      // the watchdog on the generous initial-response budget when it should
      // already have switched to the shorter between-token one.
      details.onProgress(reading.firstTokenAt !== null);

      if (
        reading.content.length > 0 &&
        performance.now() - checkpointedAt > CHECKPOINT_MS
      ) {
        await checkpoint();
        // A retry took the row while this was streaming. Reading on would only
        // burn an upstream connection to write an answer nobody is waiting for.
        if (superseded) break;
      }
    }
    reading.complete = true;
  } catch (cause) {
    console.error("Answer stream read failed", {
      messageId: details.messageId,
      cause,
    });
  }

  const metrics = measure(reading, details.upstreamAt);
  // A stream that died partway is FAILED, not SUCCESS — but the text it did
  // produce is kept, because that text is genuinely what the model said. Only
  // a clean upstream finish is allowed to claim success.
  //
  // A clean finish with no content is FAILED too. It really happens here —
  // V1's live check found a row reporting 79 tokens of usage and not one
  // visible character, a model that spent its answer on reasoning. Calling
  // that a success would put an empty card in the arena that can be voted for
  // and would feed the leaderboard a win nobody could read.
  const status =
    reading.complete && reading.content.length > 0 ? "SUCCESS" : "FAILED";

  try {
    // Conditioned on the attempt, so this is a no-op once a retry has claimed
    // the row — the write that would otherwise land here is precisely the one
    // that used to overwrite a newer answer with an older one.
    const written = await prisma.message.updateMany({
      where: { id: details.messageId, attempt: details.attempt },
      data: {
        content: reading.content,
        status,
        ...metrics,
        inputTokens: reading.inputTokens,
        outputTokens: reading.outputTokens,
      },
    });
    if (written.count === 0) {
      superseded = true;
      console.warn("Discarded a superseded answer", {
        messageId: details.messageId,
        attempt: details.attempt,
      });
    }
  } catch (cause) {
    console.error("Persisting an answer failed", {
      messageId: details.messageId,
      attempt: details.attempt,
      cause,
    });
  }

  const posthog = getPostHogClient();
  if (posthog) {
    posthog.capture({
      distinctId: details.distinctId,
      event: "$ai_generation",
      properties: {
        $ai_provider: "openrouter",
        $ai_model: details.model,
        $ai_input_tokens: reading.inputTokens,
        $ai_output_tokens: reading.outputTokens,
        $ai_latency: (performance.now() - details.upstreamAt) / 1000,
        // Every model in this app is free tier — $0 is the real, honest cost.
        $ai_total_cost_usd: 0,
      },
    });
    await posthog.flush();
  }

  // Null means nothing was stored, so there is nothing authoritative to tell
  // the browser — the route simply omits its closing frame.
  return superseded
    ? null
    : {
        status,
        outputTokens: reading.outputTokens,
        ...metrics,
      };
}

// The model never answered at all, so the row says so. Written here because
// the route is the only side that knows the upstream call failed.
export async function markAnswerFailed(messageId: string, attempt: number) {
  try {
    // Conditioned like every other write here: if a retry already claimed the
    // row, this attempt's failure is not the row's story any more.
    await prisma.message.updateMany({
      where: { id: messageId, attempt },
      data: { status: "FAILED" },
    });
  } catch (cause) {
    console.error("Marking an answer failed did not persist", {
      messageId,
      attempt,
      cause,
    });
  }
}
