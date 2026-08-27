# LLM Arena

Send one prompt to up to three AI models at once, watch them answer side by
side, and vote for the best one. Real votes and real per-call measurements
build a leaderboard of which model is actually worth using.

Every model is free tier, so cost always reads `$0.0000`. That is a real
measured number, not a placeholder, and it is shown for that reason.

> **Status:** V1 is complete and working. V2 — hardening the backend that sits
> underneath it — is in progress. See `docs/scope-v2.md` for what is done and
> what is open. A full architecture write-up is the last thing V2 does, once
> the decisions it would describe have actually been made.

## Stack

Next.js App Router · TypeScript · PostgreSQL + Prisma · Clerk · OpenRouter ·
Arcjet · PostHog · Vitest

## Running it

Needs Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local     # then fill it in
pnpm prisma migrate deploy
pnpm dev
```

Every variable in `.env.example` is required — the app fails at startup on a
missing one rather than halfway through a request. `TEST_DATABASE_URL` is the
exception: only the test suite reads it, and it must point at a **different**
database from `DATABASE_URL`.

## Checking it

```bash
pnpm test         # everything
pnpm test:unit    # the fast half — no database, no environment needed
pnpm typecheck
pnpm lint
pnpm build
```

Tests cover what a person cannot see: concurrency, stale writes, streaming
lifecycle, metric definitions. Everything visible is verified by hand against
a real browser, using the list in `docs/manual-pass.md`.

## The documentation that matters

| file                  | what it holds                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `docs/scope.md`       | V1 — every feature, the decision behind it, and how it was verified     |
| `docs/scope-v2.md`    | V2 — the hardening work, including what turned out to be wrong          |
| `docs/manual-pass.md` | the browser checks, written down so they mean the same thing every time |
| `CLAUDE.md`           | how this project is built and what it refuses to do                     |

These are the real record. They are written to be read by someone picking the
project up cold, including the parts that did not go to plan.
