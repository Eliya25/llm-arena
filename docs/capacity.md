# Capacity baseline

## Status

The repeatable harness and controlled upstream are implemented. The closure pass on 2026-08-28 confirmed that the normal portfolio Preview does not contain the load only configuration and the local environment does not contain dedicated Clerk load sessions. The official Vercel capacity number therefore remains pending. No result is claimed before that run.

## Environment

The official run uses a dedicated Vercel Preview with its own staging PostgreSQL database, Clerk test users, Arcjet site and PostHog project. Production is not required for Feature 8. `LOAD_TEST_MODE=true` is allowed only on this load Preview, and the route also refuses to enable it in a Vercel Production environment as a safety guard. `OPENROUTER_CHAT_URL` points to `/api/load/mock-openrouter`; the chat route resolves that path against the current Preview origin before making its server request. `LOAD_TEST_SECRET` protects that endpoint.

The mock accepts prompt markers for deterministic behavior:

| Marker            | Behavior                           |
| ----------------- | ---------------------------------- |
| none              | short healthy SSE stream           |
| `[load:slow]`     | one second TTFT and slow tokens    |
| `[load:truncate]` | stream fails after partial content |
| `[load:stall]`    | one token followed by silence      |
| `[load:429]`      | provider rate limit                |
| `[load:500]`      | provider failure                   |

## Run

Create several Clerk staging sessions and keep their tokens outside the repository.

```bash
LOAD_BASE_URL=https://your-load-preview.vercel.app \
LOAD_SHARED_PATH=/share/example \
LOAD_MODEL_IDS=provider/model-a:free,provider/model-b:free,provider/model-c:free \
LOAD_SESSION_TOKENS='["token-one","token-two"]' \
LOAD_CONCURRENCY=1,5,10,20 \
pnpm load:capacity
```

Each Arena unit is one real turn with three simultaneous model lanes sharing the same client turn and thread keys. Concurrency therefore counts prompts, while the report also records the resulting stream count. The harness records p50, p95 and p99 duration, worst-lane TTFT, Arcjet denial rate and internal error rate for shared reads and Arena turns. Save the JSON output alongside the Vercel runtime, database and Arcjet dashboards used during the run.

## Pass boundaries

A level has crossed capacity when any of these becomes true:

1. A normal read exceeds 2 seconds at p95.
2. Application overhead before the controlled upstream exceeds 500ms at p95.
3. Internal errors exceed 1 percent.

Arcjet denials are recorded separately and are expected when the burst scenario intentionally crosses a configured budget.

## Result

Pending the dedicated Preview run. The current environment is missing all of the following inputs required for an official run:

1. A dedicated Vercel Preview with `LOAD_TEST_MODE=true`.
2. A random `LOAD_TEST_SECRET` and `OPENROUTER_CHAT_URL=/api/load/mock-openrouter` configured only on that Preview.
3. A public shared thread path seeded in the load database.
4. Three distinct mock model IDs accepted by the application catalog for that Preview.
5. One or more saved Clerk staging session tokens in `LOAD_SESSION_TOKENS`.
6. The dedicated Preview URL in `LOAD_BASE_URL`.

Once supplied, run the existing concurrency ramp and record the first failing level, the first measured bottleneck and the Vercel, database and Arcjet observations. Do not add a queue, cache or another service unless this evidence calls for it.
