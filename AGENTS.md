<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# LLM Arena

## What this is

One prompt fans out to up to three independent model streams. The server owns persisted answers and metrics. Read `docs/scope-v2.md` before changing behavior and keep its status honest.

## Stack

TypeScript on Node 20, Next.js 16 App Router, React 19, PostgreSQL with Prisma 7, Clerk, OpenRouter, Arcjet, PostHog, Tailwind CSS 4 and Vitest. Use pnpm 11.

## Commands

```bash
pnpm dev
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:db
pnpm load:capacity
pnpm build
```

## Working agreement

Before building a feature, state what you are doing and why, then wait for approval. Record changed decisions in the scope rather than silently diverging. Report manual work as a short concrete checklist.

## Rules

1. Prefer pure functions, immutable data and side effects at route, action or integration boundaries.
2. Keep strict TypeScript and never use `any`.
3. Organize code by feature. Shared primitives belong in `components/ui` or `lib` only when genuinely cross cutting.
4. Read environment variables only through `lib/env.ts` and fail fast when an application variable is missing.
5. Never show raw exceptions or provider responses to a user.
6. Preserve visible focus, keyboard operation and contrast on every screen.
7. The browser is never authoritative for model output, lifecycle or metrics.
8. Database tests require an isolated `TEST_DATABASE_URL` and may delete their own rows.
9. No browser automation framework. Use automated tests for invisible correctness and `docs/manual-pass.md` for visible flows.
10. After a change, run formatting, lint, type checking, tests and a production build.

## Design

The visual system is recorded in `docs/scope.md`. Any UI work uses the installed `frontend-design` skill before implementation and extends the existing coffee, parchment and rust identity.

## Delivery

GitHub Actions owns Vercel deployments. Migrations are reviewed SQL, applied with `prisma migrate deploy`, and must remain compatible with the previously deployed application. See `docs/runbook.md`.

## Context files

Detailed product and implementation history lives in `docs/scope.md` and `docs/scope-v2.md`. Architecture decisions live in `docs/adr/`.

- [app/api/load/AGENTS.md](app/api/load/AGENTS.md): safety constraints for the controlled load-test upstream
