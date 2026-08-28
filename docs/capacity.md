# Capacity baseline

## Status

The repeatable harness and controlled upstream are implemented. An official Vercel capacity number is still pending because it must be run against the dedicated load Preview with staging credentials. No result is claimed before that run.

## Environment

The official run uses a Vercel Preview with its own PostgreSQL database, Clerk test users, Arcjet site and PostHog project. `LOAD_TEST_MODE=true` is allowed only outside the Vercel production environment. `OPENROUTER_CHAT_URL` points to `/api/load/mock-openrouter`; the chat route resolves that path against the current Preview origin before making its server request. `LOAD_TEST_SECRET` protects that endpoint.

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
LOAD_BASE_URL=https://preview.example \
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

Pending the dedicated Preview run. Record the first failing concurrency level, the first measured bottleneck, and any before and after change here. Do not add a queue, cache or another service unless this evidence calls for it.
