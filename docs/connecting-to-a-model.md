# Spec: Connecting to a model

Concrete record of Feature 1 in `docs/scope.md` — how a prompt actually reaches a model and streams back. If something here and `scope.md` ever disagree, `scope.md` wins — fix this doc, don't quietly follow it.

## Shape

One selected model = one independent HTTP request from the browser to `POST /api/chat`, opened in parallel with the requests for any other selected models. There is no shared or multiplexed connection fanning the three out server-side — each is its own `fetch` from the client, its own route handler invocation, its own upstream call to OpenRouter. A slow or failing model can only ever break its own stream.

```
browser ──POST /api/chat {model, prompt}──▶ route handler ──POST stream:true──▶ OpenRouter
                                                   │
                                          Arcjet.protect() gate
                                          (rate limit / bot / prompt injection)
```

## Request / response contract

`app/api/chat/route.ts`

- **In:** `{ model: string, prompt: string }` as JSON. Either missing field is a `400` (`badRequest`), no Arcjet check spent on a malformed request.
- **Out (success):** the raw OpenRouter SSE body piped straight through, `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. The route does not parse or transform chunks — the client speaks OpenRouter's own streaming format directly.
- **Out (failure):** always `Response.json({ error: <plain sentence> }, { status })`, never a raw exception or upstream error body. See the status table below.

| Status | When                                                       | User-facing message                                                                                  |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `400`  | missing `model`/`prompt`, or Arcjet flags prompt injection | field-specific, or "That prompt looks like it's trying to manipulate the model. Please rephrase it." |
| `403`  | Arcjet denies for any other reason (bot, shield)           | "Your request couldn't be processed. Please try again."                                              |
| `429`  | Arcjet rate limit                                          | "You're sending requests too quickly. Please slow down."                                             |
| `502`  | OpenRouter request fails or returns no body                | "The model didn't respond. Please try again."                                                        |

Every denial/failure path logs the real reason server-side (`console.error`) before returning the plain message — nothing raw ever reaches the client, per `CLAUDE.md`'s error-handling rule.

## Gate order inside the handler

1. Validate body shape (`400` early exit, cheapest check first).
2. Resolve Clerk `auth()` → `userId`, or the literal string `"anonymous"` if signed out. This becomes both the Arcjet `userId` characteristic and the PostHog `distinctId`.
3. `aj.protect()` — see `lib/arcjet.ts`. Denial short-circuits before OpenRouter is ever called, so a blocked request never spends a real model call.
4. PostHog `prompt_submitted` capture.
5. The actual OpenRouter call.
6. PostHog `model_response_received` / `model_response_failed`, then `flush()` — the route handler is short-lived, so events are flushed before the response streams rather than left to a background batch.

Steps 4–6 are the funnel events from Feature 6, not the per-call LLM-analytics wrapper (tokens/cost/latency) — that piece is still open, tracked under Feature 6 in `scope.md`, not here.

## Why per-model requests, not one shared stream

Considered routing all three selected models through a single connection (one request, server fans out, multiplexes three upstream streams back down one pipe). Rejected: if that one connection drops, all three answers die together, which defeats the actual point — one model being down or slow should never affect the others. Three independent `fetch` calls costs a little duplication (three sets of headers, three Arcjet checks) but means each model's failure is fully isolated, both on the wire and in the UI showing that one card.

## Config wiring

| Concern                      | File                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env validation               | `lib/env.ts`                                 | `required()` throws at import time if a var is missing — fails fast at startup, not on first request. Wired via `instrumentation.ts` so it runs before the app serves traffic.                                                                                                                                                                                                                                                        |
| Auth                         | Clerk (`@clerk/nextjs/server`), `proxy.ts`   | `clerkMiddleware()` exported from `proxy.ts`, not `middleware.ts` — Next.js 16 deprecated the latter.                                                                                                                                                                                                                                                                                                                                 |
| Rate limit / bot / injection | `lib/arcjet.ts`                              | `shield` (LIVE), `detectBot` (LIVE, denies all categories), `detectPromptInjection` (LIVE), `tokenBucket` keyed on the `userId` characteristic — refill 5/10s, capacity 10. Per-user, not per-request, so the bucket is shared across the 2–3 parallel streams one prompt fans out to.                                                                                                                                                |
| DB                           | `lib/prisma.ts`                              | `PrismaClient` + `@prisma/adapter-pg`, singleton on `globalThis` outside production to survive dev hot-reload. Must point at the **direct** `DATABASE_URL` (`db.prisma.io`), not the pooled one (`pooled.db.prisma.io`) — the pooled endpoint isn't reachable by a plain `pg` client the way the connection string implies; only Prisma's own engine speaks its protocol. See `scope.md` Feature 1/3 for the incident this came from. |
| Analytics                    | `lib/posthog-server.ts`, `app/providers.tsx` | Server-side capture in the route handler (funnel events); client provider currently just captures pageviews — session replay/heatmaps and the LLM-analytics call wrapper are still open.                                                                                                                                                                                                                                              |

## Verified

- `tsc --noEmit`, `eslint .`, `next build` all pass clean.
- Dev server boots, `/` returns `200`.
- With a real `OPENROUTER_API_KEY` and a currently-free model slug, `POST /api/chat` returns `200` and streams live SSE chunks straight from OpenRouter.
- Arcjet: a `curl`-originated request was denied as a bot (`REASON_BOT_V2`), visible via `arcjet requests list`.
- Full detail and dated verification history lives in `scope.md` Feature 1 — this doc is the durable "how it works," not the changelog.

## Open (tracked in `scope.md`, not duplicated here)

- Model-picker fan-out (Feature 5) and the vote flow (Feature 6) aren't built yet — this route only handles a single model's stream today.
- PostHog session replay/heatmaps and the per-call LLM-analytics wrapper (tokens, cost, latency per OpenRouter call) are still open.
