# Capacity baseline

## Status

The official baseline was measured on 2026-08-29 against a dedicated Vercel Preview. The first level already crossed both latency boundaries, so the ramp stopped at concurrency 1 as designed. This is a measured boundary, not a claim that the deployment supports a higher load.

## Environment

The run used the separate `llm-arena-load` Vercel project and Preview deployment `dpl_Msq6A7xktAvwqNDK5GYWbkai4ooT` in `iad1`, backed by the isolated test PostgreSQL database and Clerk development sessions. The normal portfolio Preview was not modified. Production is not required for Feature 8. `LOAD_TEST_MODE=true` was supplied only to this load Preview, and the route also refuses to enable it in a Vercel Production environment as a safety guard. `OPENROUTER_CHAT_URL` pointed to `/api/load/mock-openrouter`; `LOAD_TEST_SECRET` protected that endpoint. None of these values was written to the repository.

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

Each Arena unit is one real turn with three simultaneous model lanes sharing the same client turn and thread keys. Concurrency therefore counts prompts, while the report also records the resulting stream count. The harness records p50, p95 and p99 duration, p95 application time to upstream headers, worst-lane TTFT, HTTP status counts, Arcjet denial rate and internal error rate. Rates for Arena turns use streams, not turns, as their denominator. An unexpected non-429 client error invalidates the run. The ramp stops after the first invalid result or crossed capacity boundary.

## Pass boundaries

A level has crossed capacity when any of these becomes true:

1. A normal read exceeds 2 seconds at p95.
2. Application overhead before the controlled upstream exceeds 500ms at p95.
3. Internal errors exceed 1 percent.

Arcjet denials are recorded separately and are expected when the burst scenario intentionally crosses a configured budget.

## Result

Official run started at `2026-08-28T21:32:42.381Z` (2026-08-29 Israel time). The healthy controlled stream was used; slow, truncated and provider-error markers were not part of the baseline.

| Scenario                | Turns or reads | Streams | HTTP results | p95 total | p95 app-to-headers | p95 controlled TTFT | Denial rate | Internal error rate | Boundary                           |
| ----------------------- | -------------: | ------: | ------------ | --------: | -----------------: | ------------------: | ----------: | ------------------: | ---------------------------------- |
| Shared thread read      |              1 |       0 | `200: 1`     |   2,145ms |                n/a |                 n/a |          0% |                  0% | Failed: read p95 > 2,000ms         |
| Arena turn, three lanes |              1 |       3 | `200: 3`     |   4,782ms |            4,078ms |                16ms |          0% |                  0% | Failed: app-to-headers p95 > 500ms |

All three Arena lanes completed and persisted successfully. Arcjet produced no denial, the mock produced no upstream error and the runtime logs showed no internal failure. Because the first level crossed the agreed boundaries, levels 5, 10 and 20 and the intentional Arcjet burst were not run. No higher throughput or concurrency is inferred.

The first bottleneck is the aggregate request setup path before the controlled mock begins streaming. Its 4,078ms p95 is far larger than the mock's 16ms TTFT. That path includes serverless initialization and remote authentication, policy and database work; the available observations do not isolate one database query, so the result is not attributed to PostgreSQL alone. The shared read result independently shows the same class of cold/request setup latency. No queue, cache or new service was added: a single-sample cold baseline is evidence for future profiling, not enough evidence for an architectural change.

The official V2 conclusion is deliberately narrow: this Hobby Preview completed one three-stream Arena turn correctly, but it did not meet the chosen latency budget even at concurrency 1.
