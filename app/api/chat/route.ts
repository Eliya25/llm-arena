import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { aj } from "@/lib/arcjet";
import { env } from "@/lib/env";
import { getPostHogClient } from "@/lib/posthog-server";

type ChatRequestBody = {
  model?: string;
  prompt?: string;
};

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

// One request here = one model's own independent stream. The client opens
// one of these per selected model so a slow or failing model never blocks
// the others (docs/scope.md Feature 1).
export async function POST(request: NextRequest) {
  const { model, prompt } = (await request.json()) as ChatRequestBody;

  if (!model) return badRequest("model is required");
  if (!prompt) return badRequest("prompt is required");

  // Resolve the PostHog distinct_id from Clerk's server-side auth.
  const { userId } = await auth();
  const distinctId = userId ?? "anonymous";

  // Arcjet sits in front of the model call: rate limiting (per-person, across
  // all three parallel model streams a prompt fans out to), bot protection,
  // and prompt-injection detection (docs/scope.md Feature 6).
  const decision = await aj.protect(request, {
    userId: distinctId,
    requested: 1,
    detectPromptInjectionMessage: prompt,
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
        { error: "That prompt looks like it's trying to manipulate the model. Please rephrase it." },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Your request couldn't be processed. Please try again." },
      { status: 403 },
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
        prompt_length: prompt.length,
      },
    });
  }

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
        messages: [{ role: "user", content: prompt }],
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

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
