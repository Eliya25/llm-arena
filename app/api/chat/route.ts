import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { aj } from "@/lib/arcjet";
import { env } from "@/lib/env";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { getPostHogClient } from "@/lib/posthog-server";
import { prisma } from "@/lib/prisma";

const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 32_000;
// createTurn runs alongside this request rather than before it, so on a first
// send the row can still be a moment away. The stream itself takes far longer
// than this, so these retries effectively never all get used.
const ROW_LOOKUP_ATTEMPTS = 6;
const ROW_LOOKUP_DELAY_MS = 400;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// Which message row this stream belongs to. `messageId` is used for a retry or
// a restored turn, where the client already knows the row; `clientKey` is the
// first-send case, where createTurn is still in flight. Both are only ever
// used to *locate* a row the caller already owns — the content written into it
// comes from the model's stream, never from the browser.
type AnswerTarget = { messageId?: string; clientKey?: string };

type ChatRequestBody = AnswerTarget & {
  model?: string;
  messages?: ChatMessage[];
};

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function isValidMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ChatMessage>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.length > 0 &&
    message.content.length <= MAX_CONTENT_LENGTH
  );
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Locates the caller's own message row for this stream. Scoped through the
// relation chain to the Clerk user every time, so neither identifier can reach
// a row belonging to somebody else. Retries only matter on a first send, where
// createTurn is deliberately still running in parallel.
async function findAnswerRow(
  target: AnswerTarget,
  model: string,
  clerkId: string,
): Promise<string | null> {
  const where = target.messageId
    ? {
        id: target.messageId,
        model,
        turn: { thread: { user: { clerkId } } },
      }
    : {
        model,
        turn: { clientKey: target.clientKey, thread: { user: { clerkId } } },
      };

  for (let attempt = 0; attempt < ROW_LOOKUP_ATTEMPTS; attempt += 1) {
    const message = await prisma.message.findFirst({
      where,
      select: { id: true },
    });
    if (message) return message.id;
    await sleep(ROW_LOOKUP_DELAY_MS);
  }
  return null;
}

// Reads a copy of the upstream SSE stream — the only place in the app that
// actually sees what the model said — and does two things with it: writes the
// answer and its measured metrics to the database, and reports the call to
// PostHog's LLM analytics ($ai_generation).
//
// This runs off a tee() branch rather than a transform in the client's path,
// so it keeps reading even if the browser disconnects: closing the tab
// mid-answer still saves the answer instead of stranding a PENDING row.
async function recordAnswer(
  branch: ReadableStream<Uint8Array>,
  details: {
    model: string;
    distinctId: string;
    startedAt: number;
    target: AnswerTarget;
  },
) {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let firstTokenAt: number | undefined;
  let endedAt: number | undefined;
  let content = "";
  let streamComplete = false;

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
        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            if (firstTokenAt === undefined) firstTokenAt = performance.now();
            content += delta;
          }
          if (typeof chunk.usage?.prompt_tokens === "number") {
            inputTokens = chunk.usage.prompt_tokens;
          }
          if (typeof chunk.usage?.completion_tokens === "number") {
            outputTokens = chunk.usage.completion_tokens;
          }
        } catch {
          // Not JSON — skip the line.
        }
      }
    }
    endedAt = performance.now();
    streamComplete = true;
  } catch (cause) {
    console.error("Answer stream read failed", cause);
  }

  // An incomplete stream stays PENDING — "this answer didn't finish" is the
  // honest record, and writing SUCCESS on a truncated read would not be.
  if (streamComplete) {
    try {
      const messageId = await findAnswerRow(
        details.target,
        details.model,
        details.distinctId,
      );
      if (messageId) {
        const tokensPerSecond =
          outputTokens !== undefined &&
          firstTokenAt !== undefined &&
          endedAt !== undefined &&
          endedAt > firstTokenAt
            ? outputTokens / ((endedAt - firstTokenAt) / 1000)
            : null;

        await prisma.message.update({
          where: { id: messageId },
          data: {
            content,
            status: "SUCCESS",
            // Measured here rather than in the browser, so the number is the
            // model's own latency and not the visitor's connection.
            timeToFirstTokenMs:
              firstTokenAt !== undefined
                ? Math.round(firstTokenAt - details.startedAt)
                : null,
            tokensPerSecond,
            totalTokens: outputTokens ?? null,
          },
        });
      } else {
        console.error("No message row for finished answer", {
          model: details.model,
          target: details.target,
        });
      }
    } catch (cause) {
      console.error("Persisting answer failed", cause);
    }
  }

  const posthog = getPostHogClient();
  if (!posthog) return;
  posthog.capture({
    distinctId: details.distinctId,
    event: "$ai_generation",
    properties: {
      $ai_provider: "openrouter",
      $ai_model: details.model,
      $ai_input_tokens: inputTokens ?? null,
      $ai_output_tokens: outputTokens ?? null,
      $ai_latency: (performance.now() - details.startedAt) / 1000,
      // Every model in this app is free tier — $0 is the real, honest cost.
      $ai_total_cost_usd: 0,
    },
  });
  await posthog.flush();
}

// The model never answered, so the row says so — written here because the
// route is the only side that knows the upstream call failed.
async function markAnswerFailed(
  target: AnswerTarget,
  model: string,
  clerkId: string,
) {
  try {
    const messageId = await findAnswerRow(target, model, clerkId);
    if (!messageId) return;
    await prisma.message.update({
      where: { id: messageId },
      data: { status: "FAILED" },
    });
  } catch (cause) {
    console.error("Marking answer failed did not persist", cause);
  }
}

// One request here = one model's own independent stream. The client opens
// one of these per selected model so a slow or failing model never blocks
// the others (docs/scope.md Feature 1).
export async function POST(request: NextRequest) {
  const { model, messages, messageId, clientKey } =
    (await request.json()) as ChatRequestBody;

  if (!model) return badRequest("model is required");
  if (typeof messageId !== "string" && typeof clientKey !== "string") {
    return badRequest("This answer couldn't be started. Please try again.");
  }
  const target: AnswerTarget = { messageId, clientKey };
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES ||
    !messages.every(isValidMessage)
  ) {
    return badRequest(
      "This conversation couldn't be sent. Try a shorter message.",
    );
  }
  if (messages[messages.length - 1].role !== "user") {
    return badRequest("messages must end with a user message");
  }

  const latestPrompt = messages[messages.length - 1].content;

  // Sending needs an account — decided in docs/scope.md Feature 8 ("only
  // sending a prompt and voting need sign-in"). The UI gates this too, but
  // the rule has to hold at the endpoint, not just in the browser.
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: "Please sign in to send a prompt." },
      { status: 401 },
    );
  }
  const distinctId = userId;

  // Arcjet sits in front of the model call: rate limiting (per-person, across
  // all three parallel model streams a prompt fans out to), bot protection,
  // and prompt-injection detection (docs/scope.md Feature 6).
  const decision = await aj.protect(request, {
    userId: distinctId,
    requested: 1,
    detectPromptInjectionMessage: latestPrompt,
    // Scan the latest user message explicitly — the body was already consumed
    // by request.json() above, so the deprecated whole-body scan can't run.
    sensitiveInfoValue: latestPrompt,
  });

  if (decision.isDenied()) {
    console.error("Arcjet denied request", {
      reason: decision.reason,
      userId: distinctId,
    });

    if (decision.reason.isRateLimit()) {
      return Response.json(
        { error: "You're sending requests too quickly. Please slow down." },
        { status: 429 },
      );
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

    return Response.json(
      { error: "Your request couldn't be processed. Please try again." },
      { status: 403 },
    );
  }

  // The browser's picker only offers free-tier models, but that's not a
  // guarantee — a hand-crafted request could name any model and spend real
  // money on the app's OpenRouter key. Only models in the server's own
  // free-tier catalog go upstream; if the catalog can't be fetched, this
  // deliberately fails closed rather than forwarding unverified ids.
  const catalog = await getFreeModelCatalog();
  if (!catalog.some((entry) => entry.id === model)) {
    return badRequest(
      "That model isn't available here. Pick one from the model list.",
    );
  }

  const posthog = getPostHogClient();

  // Track that the user submitted a prompt to a model.
  if (posthog) {
    posthog.capture({
      distinctId,
      event: "prompt_submitted",
      properties: {
        model,
        prompt_length: latestPrompt.length,
        message_count: messages.length,
      },
    });
  }

  const startedAt = performance.now();
  const upstream = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        // Ask OpenRouter to append real token usage to the final stream chunk,
        // so the client shows measured counts, never estimates.
        usage: { include: true },
        messages,
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("OpenRouter request failed", {
      model,
      status: upstream.status,
      detail,
    });

    // Track model failure so it can be monitored in PostHog.
    if (posthog) {
      posthog.capture({
        distinctId,
        event: "model_response_failed",
        properties: {
          model,
          status_code: upstream.status,
        },
      });
      await posthog.flush();
    }

    // The browser can no longer write this outcome, so the route records it.
    await markAnswerFailed(target, model, distinctId);

    return Response.json(
      { error: "The model didn't respond. Please try again." },
      { status: 502 },
    );
  }

  // Track a successful model response.
  if (posthog) {
    posthog.capture({
      distinctId,
      event: "model_response_received",
      properties: {
        model,
      },
    });
    // This route handler is short-lived — flush before the response streams.
    await posthog.flush();
  }

  // One copy streams to the browser, the other is the app's own record of what
  // the model actually said — it writes the answer and feeds LLM analytics.
  const [clientBranch, recordBranch] = upstream.body.tee();
  void recordAnswer(recordBranch, { model, distinctId, startedAt, target });

  return new Response(clientBranch, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
