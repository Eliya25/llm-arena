import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { aj } from "@/lib/arcjet";
import { env } from "@/lib/env";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { getPostHogClient } from "@/lib/posthog-server";

const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 32_000;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
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

// Reads a copy of the upstream SSE stream and reports the call itself to
// PostHog's LLM analytics ($ai_generation) with measured tokens and latency —
// separate from the funnel events, per docs/scope.md Feature 6.
async function captureGeneration(
  branch: ReadableStream<Uint8Array>,
  details: { model: string; distinctId: string; startedAt: number },
) {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

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
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
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
  } catch (cause) {
    console.error("LLM analytics stream read failed", cause);
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

// One request here = one model's own independent stream. The client opens
// one of these per selected model so a slow or failing model never blocks
// the others (docs/scope.md Feature 1).
export async function POST(request: NextRequest) {
  const { model, messages } = (await request.json()) as ChatRequestBody;

  if (!model) return badRequest("model is required");
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

  // One copy streams to the browser, the other feeds LLM analytics.
  const [clientBranch, analyticsBranch] = upstream.body.tee();
  void captureGeneration(analyticsBranch, { model, distinctId, startedAt });

  return new Response(clientBranch, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
