import { NextRequest, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { aj } from "@/lib/arcjet";
import { env } from "@/lib/env";
import { getFreeModelCatalog } from "@/lib/openrouter";
import {
  asResponse,
  classifyUpstream,
  failure,
  worthRetrying,
} from "@/lib/failure";
import { track } from "@/lib/analytics";
import { claimAnswerRow } from "./answer-row";
import { readChatRequest } from "./request-shape";
import {
  markAnswerFailed,
  recordAnswer,
  type AnswerResult,
} from "./record-answer";

// The server's own patience, independent of the browser's. Two budgets,
// because they are two different kinds of silence: a free model can genuinely
// take a long time to start (measured first tokens in this database include
// 43s and 51s), but once tokens are flowing, a full minute of nothing means
// the stream has died. Mirrors the client's budgets deliberately — the point
// is that the write path no longer depends on the client having them.
const FIRST_TOKEN_MS = 120_000;
const STALL_MS = 60_000;
// If the final database write somehow hangs, the browser is not held open
// waiting for a frame describing it.
const FINAL_FRAME_MS = 5_000;

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

// Closes the browser's copy of the stream with what the server actually
// stored. Until this frame the lane is showing its own live estimates; after
// it, every resting number on screen is a value read back out of the database.
// It also means a lane cannot read "finished" before its row is written, which
// is what the vote rules are checked against.
function withFinalFrame(result: Promise<AnswerResult | null>) {
  const encoder = new TextEncoder();
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
    async flush(controller) {
      const record = await Promise.race([
        result,
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), FINAL_FRAME_MS),
        ),
      ]);
      if (!record) return;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ arena: record })}\n\n`),
      );
    },
  });
}

// One retry, and only before a single token exists.
//
// At this point the browser has seen nothing and the row holds nothing, so a
// second attempt is genuinely the same request rather than a duplicate of a
// partial one. Once tokens are flowing that stops being true, which is why
// there is no retry anywhere past this function.
//
// Never on 429: that is the provider answering clearly, and asking again
// immediately only spends the same quota to be told the same thing. Free-tier
// models are busy often enough that retrying them would make a slow lane out
// of an already-failed one.
async function callUpstream(
  model: string,
  messages: readonly { role: string; content: string }[],
  signal: AbortSignal,
): Promise<Response | null> {
  const attempt = () =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        // Ask OpenRouter to append real token usage to the final stream chunk,
        // so what gets measured is reported usage, never an estimate.
        usage: { include: true },
        messages,
      }),
      signal,
    }).catch((cause: unknown) => {
      console.error("OpenRouter request threw", { model, cause });
      return null;
    });

  const first = await attempt();
  if (first && (first.ok || !worthRetrying(first.status))) return first;
  // The watchdog may have ended this while we were deciding.
  if (signal.aborted) return first;

  console.error("Retrying OpenRouter once", {
    model,
    status: first?.status ?? "threw",
  });
  // The body of a failed response is never read, so dropping it is safe.
  return (await attempt()) ?? first;
}

// One request here = one model's own independent stream. The client opens
// one of these per selected model so a slow or failing model never blocks
// the others (docs/scope.md Feature 1).
//
// It is also the only writer of an answer. It resolves its own database row
// before calling the model, measures the stream itself, and writes content,
// status, and metrics from its own copy — the browser supplies which row and
// nothing else (docs/scope-v2.md Feature 1).
export async function POST(request: NextRequest) {
  const shape = readChatRequest(await request.json());
  if (!shape.ok) return badRequest(shape.error);
  const { model, messages, target, prompt: latestPrompt } = shape.request;

  // Sending needs an account — decided in docs/scope.md Feature 8 ("only
  // sending a prompt and voting need sign-in"). The UI gates this too, but
  // the rule has to hold at the endpoint, not just in the browser.
  //
  // Fails closed, deliberately: if Clerk cannot be reached we cannot tell who
  // is asking, and a thread has to belong to someone. Refusing is the only
  // answer that keeps that true. Unwrapped, this was an unhandled throw — a
  // 500 with a raw error behind it.
  const userId = await auth()
    .then(({ userId }) => userId)
    .catch((cause: unknown) => {
      console.error("Could not establish identity", { cause });
      return null;
    });
  if (!userId) return asResponse(failure("unauthenticated"));
  const distinctId = userId;

  // Arcjet sits in front of the model call: rate limiting (per-person, across
  // all three parallel model streams a prompt fans out to), bot protection,
  // and prompt-injection detection (docs/scope.md Feature 6). It also now
  // guards this route's own writes, which is why the separate weighted cost
  // the old createTurn action paid is gone with it.
  //
  // Fails OPEN when Arcjet itself cannot be reached, and that is a decision
  // rather than an accident. Arcjet here is abuse mitigation, not
  // authorization: the caller is already signed in, the model allowlist below
  // still holds, and every model is free, so the blast radius of an
  // unprotected minute is bounded. Failing closed would turn a vendor outage
  // into a total outage of the product's one feature. The accepted risk is
  // real and worth naming — during such a minute the rate limit, the
  // injection check and the card-number check are all absent — which is why
  // it is logged at error level rather than swallowed.
  const decision = await aj
    .protect(request, {
      userId: distinctId,
      requested: 1,
      detectPromptInjectionMessage: latestPrompt,
      // Scan the latest user message explicitly — the body was already
      // consumed by request.json() above, so the deprecated whole-body scan
      // can't run.
      sensitiveInfoValue: latestPrompt,
    })
    .catch((cause: unknown) => {
      console.error("Arcjet unreachable, allowing the request", { cause });
      return null;
    });

  if (decision?.isDenied()) {
    console.error("Arcjet denied request", {
      reason: decision.reason,
      userId: distinctId,
    });

    if (decision.reason.isRateLimit()) {
      return asResponse(failure("rate_limited"));
    }

    if (decision.reason.isSensitiveInfo()) {
      return Response.json(
        {
          error:
            "That prompt looks like it contains a card number. Threads are public by link, so please remove it and try again.",
        },
        { status: 400 },
      );
    }

    if (decision.reason.isPromptInjection()) {
      return Response.json(
        {
          error:
            "That prompt looks like it's trying to manipulate the model. Please rephrase it.",
        },
        { status: 400 },
      );
    }

    return asResponse(failure("security_denied"));
  }

  // The browser's picker only offers free-tier models, but that's not a
  // guarantee — a hand-crafted request could name any model and spend real
  // money on the app's OpenRouter key. Only models in the server's own
  // free-tier catalog go upstream; if the catalog can't be fetched, this
  // deliberately fails closed rather than forwarding unverified ids.
  const catalog = await getFreeModelCatalog();
  // An empty catalog means the list could not be fetched, not that every model
  // vanished. Still fails closed — we cannot vouch for a model we cannot see —
  // but telling someone to pick from a list an outage just emptied is a maze
  // with no exit.
  if (catalog.length === 0) {
    console.error("Model catalog unavailable, refusing to forward", { model });
    return asResponse(failure("catalog_unavailable"));
  }
  if (!catalog.some((entry) => entry.id === model)) {
    return asResponse(failure("model_not_allowed"));
  }

  // Before the model is called, not after it answers: by the time a token
  // exists there is provably a row to write it to, and no lookup can lose a
  // race with a write happening somewhere else.
  const row = await claimAnswerRow({
    target,
    model,
    prompt: latestPrompt,
    clerkId: distinctId,
  }).catch((cause) => {
    console.error("Claiming an answer row failed", { model, cause });
    return null;
  });
  if (!row) {
    return badRequest("This answer couldn't be started. Please try again.");
  }
  // The ids travel back on the response itself, so the browser learns where
  // this answer lives the moment the stream opens rather than by racing a
  // separate write. They are the only thing it needs for voting and retrying.
  const answerHeaders = {
    "X-Arena-Thread-Id": row.threadId,
    "X-Arena-Turn-Id": row.turnId,
    "X-Arena-Message-Id": row.messageId,
  };
  // No abort listener here, deliberately. Marking a row failed the moment the
  // browser leaves was tried and reverted: a live check showed the handler
  // survives a refresh perfectly well — one lane went on to write 3143
  // characters fifty seconds after the page reloaded, and a lane still waiting
  // on its first token was closed out by the watchdog below, on time. Reacting
  // to the disconnect would only have published "didn't answer" over a
  // generation that was still on its way.

  track({
    distinctId,
    event: "prompt_submitted",
    properties: {
      model,
      prompt_length: latestPrompt.length,
      message_count: messages.length,
    },
  });

  // The server's own stall watchdog. A silent upstream is aborted here rather
  // than waited on forever — and rather than being the browser's job, which is
  // exactly the kind of thing the browser can no longer be trusted with.
  const upstreamAbort = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armWatchdog = (hasFirstToken: boolean) => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () => upstreamAbort.abort(),
      hasFirstToken ? STALL_MS : FIRST_TOKEN_MS,
    );
  };
  armWatchdog(false);

  const upstream = await callUpstream(model, messages, upstreamAbort.signal);
  // Time to first token is measured from here — response headers in hand — so
  // it is the model's own latency and carries neither the browser's connection
  // nor the time spent reaching OpenRouter.
  const upstreamAt = performance.now();

  if (!upstream || !upstream.ok || !upstream.body) {
    clearTimeout(stallTimer);
    const status = upstream?.status ?? 502;
    const detail = upstream ? await upstream.text().catch(() => "") : "";
    console.error("OpenRouter request failed", { model, status, detail });

    track({
      distinctId,
      event: "model_response_failed",
      properties: { model, status_code: status },
    });

    // The browser can't write this outcome, so the route records it.
    await markAnswerFailed(row.messageId, row.attempt);

    // A 429 is not silence — the model answered, and the answer was "I'm
    // full". classifyUpstream keeps that distinction, and the wording that
    // goes with it, in one place.
    const failed = classifyUpstream(status);
    return Response.json(
      { error: failed.message },
      { status: failed.status, headers: answerHeaders },
    );
  }

  track({
    distinctId,
    event: "model_response_received",
    properties: { model },
  });

  // One copy streams to the browser, the other is the app's own record of what
  // the model actually said. The recording branch is handed to after(), so the
  // platform keeps this work alive once the response is done: a closed tab
  // ends the browser's copy, not the answer.
  const [clientBranch, recordBranch] = upstream.body.tee();
  const recording = recordAnswer(recordBranch, {
    messageId: row.messageId,
    attempt: row.attempt,
    model,
    distinctId,
    upstreamAt,
    onProgress: armWatchdog,
  }).finally(() => clearTimeout(stallTimer));
  after(recording);

  return new Response(clientBranch.pipeThrough(withFinalFrame(recording)), {
    headers: {
      ...answerHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
