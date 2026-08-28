# Controlled load upstream

## Overview

This area provides deterministic OpenRouter compatible behavior for capacity tests. It exists only for a dedicated non production load Preview.

## Key files

| File                       | Owns                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `mock-openrouter/route.ts` | Secret protected SSE scenarios for healthy, slow, truncated, stalled, 429 and 500 responses |

## Conventions

1. Every route returns 404 unless `LOAD_TEST_MODE=true` and `LOAD_TEST_SECRET` matches in constant time.
2. Vercel production must ignore load mode even when the flag is configured accidentally.
3. Keep scenarios deterministic so capacity runs remain comparable.
4. Never bypass Clerk or Arcjet in `/api/chat` for a load test.

## Related documentation

See `docs/capacity.md` for environment setup, thresholds and the run command.
