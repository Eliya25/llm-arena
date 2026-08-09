# Scope: LLM Arena

Send one prompt, watch up to three AI models answer it at the same time, and vote for the best one. Over time those votes and the real per-call numbers, speed, tokens, cost, build an honest leaderboard of which model is actually worth using.

Build it in a thin, working slice first, one prompt actually reaching a model and coming back, before making any single part of it fuller. Then thicken it piece by piece. Before building anything, decide what you're doing and why in a few plain sentences, then build it, and if the plan turns out wrong once it's actually built, say so and fix the plan too, not just the code.

Whenever a "build it" style step actually gets underway, break it into its own short list of what's genuinely being done, and check each part off as it's finished, right in this file. That way this file can be opened fresh, in a brand new conversation, and it's obvious what's already done and what's still left, without anyone re-explaining the feature from scratch.

## Stack

Already decided, nothing open here: Next.js (App Router), TypeScript, Tailwind, shadcn for components (card, button, popover, loading skeleton, and whatever else the UI actually needs as it gets built), Prisma with Postgres, Clerk for auth, Arcjet in front of the endpoint, PostHog for analytics and observability.

## Sketches

There are rough hand-drawn sketches for the arena screen, the leaderboard, and the models page. Treat them as structure only, where things sit, what exists on the page, not as the final design or the actual colors, all of that is already decided elsewhere in this file. If something in a sketch genuinely contradicts what's written here, stop and ask which one actually wins rather than guessing.

## At a glance

| #   | Feature                                     | Phase      | Status                           |
| --- | ------------------------------------------- | ---------- | -------------------------------- |
| 1   | Connecting to a model                       | Foundation | done                             |
| 2   | Coding standards & tooling                  | Foundation | done                             |
| 3   | Data model                                  | Foundation | done                             |
| 4   | Design & look                               | Foundation | done                             |
| 5   | Model picker                                | Slice 1    | not started                      |
| 6   | Send a prompt, parallel streams, and voting | Slice 1    | not started                      |
| 7   | App shell & thread history                  | Slice 2    | UI built, real data/auth pending |
| 8   | Public thread visibility & sharing          | Slice 3    | not started                      |
| 9   | Leaderboard: global & personal              | Slice 4    | not started                      |

## Foundation

### 1. How the app actually connects to a model

The Next.js project itself gets created manually first, `create-next-app`, fast and simple, no reason to spend agent time or tokens on something that easy.

Two real decisions still open once that exists: how the app calls OpenRouter to get a model's answer, and how streaming three models back to the browser at once should actually work. This one's worth real thought: routing all three through one shared connection looks simpler, but if that one connection drops, all three answers die together, which breaks the whole point of one model failing never affecting the others. Decide both properly, then wire them, along with Prisma, Clerk, and Arcjet, into the project that already exists.

PostHog should be wired in from the start too, session replay and heatmaps turned on, and tied to the signed-in user once Clerk resolves, so events are attached to a real person, not left anonymous.

**Decided:** each selected model gets its own independent request/stream to a dedicated route handler — no shared/multiplexed connection — so one model dying never touches the others. `app/api/chat/route.ts` takes `{ model, prompt }`, calls OpenRouter's chat completions endpoint with `stream: true`, and pipes the upstream body straight back to the browser; upstream failures are logged server-side and turned into a plain `502` message, never a raw exception.

Clerk, Prisma, and PostHog are installed and wired at the config level (env validation, middleware/proxy, providers, a Prisma client singleton on the `prisma-client` + `@prisma/adapter-pg` driver-adapter pattern that Prisma 7 now requires) but are running on placeholder env values, since real accounts for them don't exist yet. Prisma has no models yet (that's Feature 3), Clerk has no sign-in UI, PostHog is just capturing pageviews. `lib/env.ts` fails fast at startup (wired via `instrumentation.ts`) if any of these env vars are missing, per the coding rules.

Arcjet is ahead of the rest: it's live on `POST /api/chat` (`lib/arcjet.ts` + the `aj.protect()` call in the route handler), running against a real `ARCJET_KEY` for a site named `llm-arena` (created via the Arcjet CLI device-flow login). Rules: `shield` (common web attacks), `detectBot` (denies all bot categories), `detectPromptInjection` (scores the prompt text itself), and a `tokenBucket` rate limit keyed per-user via the `userId` characteristic (Clerk `userId`, or `"anonymous"` when signed out) — refill 5 per 10s, capacity 10 — so the limit holds across all three parallel model streams a single prompt fans out to, not just per HTTP request. Denials map to a plain-language message per CLAUDE.md's error-handling rule: `429` for rate limit, `400` for prompt injection, `403` default for bot/shield. Verified live: `curl`-originated requests were denied with `REASON_BOT_V2` and the decisions are visible via `arcjet requests list --site-id site_01kzksm2t0eqmb532axepsmfay`.

One thing worth flagging: Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts` — used the new convention here (`clerkMiddleware()` still works as the exported default, just under the new filename) rather than building on a convention that's already deprecated on day one.

Verified: `tsc --noEmit`, `eslint .`, and `next build` all pass clean. Dev server boots and `/` returns 200. With a real `OPENROUTER_API_KEY` and a currently-free model slug, `POST /api/chat` returns `200` and streams live SSE chunks straight back from OpenRouter — the core connection actually works end-to-end. (Note: OpenRouter's free-tier model slugs shift over time — Feature 5's live catalog fetch is what keeps the picker honest about which are actually free right now, rather than a hardcoded list going stale.)

Real credentials now in place for everything: `OPENROUTER_API_KEY`, Clerk keys, `ARCJET_KEY`, `DATABASE_URL`, and PostHog keys. No more placeholders.

**Full verification pass (2026-08-09), each piece checked independently against its real credential:**

- `tsc --noEmit`, `eslint .`, `next build` — all clean.
- OpenRouter: direct call with the real key streams a real `200` SSE response.
- Clerk: `CLERK_SECRET_KEY` authenticates against `api.clerk.com` (`200`).
- Arcjet: live on `/api/chat` — a `curl` request was correctly denied as a bot (`denied: ['CURL']`), decision logged server-side.
- PostHog: a direct capture call to the real project returns `200 {"status":"Ok"}`.
- Prisma **migrations**: `prisma migrate status` reports the database up to date with the one local migration; `prisma db pull` introspection matches `prisma/schema.prisma` exactly.

**Fixed:** the app's runtime `PrismaClient` (`lib/prisma.ts`, via `@prisma/adapter-pg`) couldn't connect against the pooled `DATABASE_URL` (`pooled.db.prisma.io`) — every query failed with `role "User" does not exist`, even though the Prisma CLI worked fine against that same URL. Root cause: that pooled endpoint just isn't reachable by a plain `pg` (node-postgres) client the way a raw connection string implies — only Prisma's own engine speaks whatever protocol it actually needs. The fix was switching `DATABASE_URL` to the **direct** connection string (`db.prisma.io`, not `pooled.db.prisma.io`) obtained via `npx prisma bootstrap --api-key ... --database ...`, which re-linked the project and produced the correct non-pooled URL. Re-verified end to end: a full create/read/delete round-trip across all five models (`User` → `Thread` → `Turn` → `Message` → `Vote`) now succeeds through `lib/prisma.ts` itself, not just the CLI. `tsc --noEmit`, `eslint .`, `next build` all still pass clean.

- [x] Decide the approach
- [x] Confirm a real model streams back
- [x] Get a real Arcjet key and apply it to `/api/chat` (rate limit, bot protection, prompt-injection shield — see Feature 6 note above)
- [x] Get a real Postgres URL and apply it (see Feature 3)
- [x] Get remaining real credentials (PostHog project key)
- [x] Fix `lib/prisma.ts` runtime connection (switched to the direct, non-pooled `DATABASE_URL`)
- [x] Write the spec (`docs/connecting-to-a-model.md` — request/response contract, gate order, the per-model-vs-shared-stream decision, config wiring)

### 2. Coding standards & tooling

Write down the real conventions for this project once it actually exists, then install linting, formatting, and a pre-commit hook that actually enforces them.

**Decided and built:** Prettier (`prettier-plugin-tailwindcss`, sorted against `app/globals.css` since Tailwind v4 here is CSS-first with no `tailwind.config.*`) plus `eslint-config-prettier` so ESLint and Prettier don't fight over style rules. Kept `eslint-config-next` for lint (already brings jsx-a11y for the accessibility-baseline rule) and turned `@typescript-eslint/no-explicit-any` into a hard error, since "strict TypeScript, no `any`" needs an enforced rule, not just a convention. Added `format`, `format:check`, and `typecheck` scripts alongside the existing `lint`. Husky + lint-staged run on every commit: `eslint --fix` + `prettier --write` on staged files, then a full-project `tsc --noEmit` (deliberately whole-project, not staged-only — a one-file commit can still break a type elsewhere). The full repo was reformatted with Prettier as its own standalone commit before the hook was wired in, so the hook's first real run wasn't fighting a repo-wide diff; `.claude/` (vendored skill content) was excluded from that reformat.

**Fixed:** the pre-commit hook initially failed to actually run eslint/prettier at all — `cmd.exe` itself couldn't be spawned (`ENOENT`) because the invoking shell's `PATH` didn't include `C:\Windows\System32`, which Windows needs to execute the `.cmd` shims lint-staged spawns. This blocked every commit outright with an unhelpful `ENOENT`, rather than actually linting — wrong failure, not a silent pass. Fixed by having `.husky/pre-commit` defensively add `C:\Windows\System32` to `PATH` itself, so it doesn't depend on the caller's shell having it. Verified all three directions with throwaway commits, each then removed: a file with an explicit `any` was blocked with the real ESLint error, a file with a real type error (`const n: number = "x"`, which passes ESLint since it isn't type-aware) was blocked by `tsc --noEmit`, and a clean file committed successfully.

Conventions written up in `docs/coding-standards.md`: naming/folder-by-feature structure, functional-style rules, TypeScript/`any` policy, error-handling shape, styling/shared-values rule, import rules, and the exact commands to run before calling anything done.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, and `next build` all pass clean.

- [x] Decide the approach
- [x] Install lint, format, and whatever else is needed, and write it up in a coding-standards doc

### 3. Data model

The core things every feature depends on: users tied to Clerk, threads, each model's own messages inside a thread, and votes. A vote should only ever be possible on a turn where two or more models actually answered.

**Decided and built:** five models in `prisma/schema.prisma` — `User` (`clerkId` unique, no Clerk profile data duplicated), `Thread` (belongs to a `User`), `Turn` (belongs to a `Thread`, one row per prompt sent — this is what a prompt fans out from), `Message` (belongs to a `Turn`, one row per model's independent answer, carries `status` plus the per-answer metrics Feature 6 needs — `timeToFirstTokenMs`, `tokensPerSecond`, `totalTokens`), and `Vote` (`turnId` unique so picking a winner writes exactly one vote per turn, references the winning `Message`). The "only once two-or-more models have answered" rule is enforced at the app layer when a vote is cast, not as a DB constraint — Postgres can't cleanly express a sibling-row count check.

`prisma.config.ts` was fixed to load `.env.local` (this project's real secret store) instead of the default `.env` — bare `dotenv/config` was only reading `.env`, so `prisma migrate dev` was silently connecting to the old localhost placeholder instead of the real Prisma Postgres instance.

Verified against the real database: `npx prisma migrate dev --name init` applied cleanly, `npx prisma generate` produced working model delegates. `tsc --noEmit`, `eslint .`, and `next build` all still pass clean.

**Correction, then fix (2026-08-09):** the create/read/delete round-trip claimed above didn't actually pass at the time — `lib/prisma.ts`'s runtime client couldn't authenticate against the pooled `DATABASE_URL`. Root-caused and fixed by switching to the direct (non-pooled `db.prisma.io`) connection string — see the Feature 1 verification note for the full story. A real round-trip across all five models now succeeds through application code, not just the CLI.

- [x] Decide the approach
- [x] Build it

### 4. Design & look

A coffee or dark brown background, warm, not neutral gray or true black. One accent color, rust, used only for things you interact with, buttons, links, focus states, the win-rate bar, never as decoration. Because the background and the accent are both warm tones from the same family, the accent has to stay clearly brighter and more saturated than the background, enough that a button never blends into the page behind it, that's a real risk with two warm colors this close and worth checking by eye, not just by the numbers. Blue, indigo, and purple are never the accent, under any circumstance. Green is reserved only for marking a winner, red only for errors, never reused for anything else. Contrast should genuinely hold up in both light and dark mode, not just look fine at a glance.

**Decided:** grounded the direction in what the product actually is, a scorecard/instrument panel for judging three simultaneous model answers, not a generic chat UI, to avoid the templated AI-design defaults (`frontend-design` skill installed via `npx skills add anthropics/skills@frontend-design` and used for this, since it wasn't present in this project yet).

Palette (six named hex values, layered warm-brown depth rather than flat brown-on-brown): `--bg #22160F`, `--surface #2E1F16`, `--border #4A3527`, `--ink #F2E9DE`, `--ink-muted #B6A08C`, `--rust #E2662A` (accent). `--win-green #4F9A5D` and `--error #D93A4A` sit outside the six as the two reserved single-purpose colors; error was deliberately pushed toward crimson and rust kept orange-leaning so the two don't read as the same red under the accent-vs-error rule.

Type, three roles, each earning its place rather than decorative: **Fraunces** (warm variable serif) used sparingly for the big win-rate numeral and page titles only, ties to the coffee identity without repeating the cream-background-plus-terracotta cliché since this palette is dark and inverted from that. **Inter** for body text. **JetBrains Mono** for model slugs, ms, tokens/sec, token counts, real machine telemetry, not decoration.

Signature element: the win-tally bar itself, "won 4 of 5" as a big Fraunces numeral next to a row of small rust tick marks, filled vs. empty, not an abstract percentage. This comes straight from the existing scope.md rule that win rate is always written as a count, so the one memorable visual element encodes a real fact instead of being applied decoration.

Layout: the arena page as three lanes with hairline dividers between them, matching the sketch's structure; leaderboard rows built around the tally bar; models page a plain scannable list. Moderate radius (10px cards, 6px buttons, pill chips), 1px hairline borders, shadows reserved for popovers only, flat and disciplined rather than dense or newspaper-like.

Motion tied to function, not ambient effect: a blinking caret per lane while a model is actively streaming, a live-ticking tokens/sec readout, and on vote the winning lane's border shifts to green while the other lanes dim to roughly 70% opacity. All of it respects `prefers-reduced-motion`.

Open risk to verify by eye once this is actually wired into `globals.css` and the shadcn theme tokens: confirm rust reads clearly brighter and more saturated than the `--bg`/`--surface` family in both light and dark mode, per the risk already called out above.

**Built:** shadcn initialized (`components.json`, `base-nova` style, `neutral` base color overridden entirely by the tokens below; `lib/utils.ts` for `cn()`). `app/globals.css` rewritten as the real token system: dark coffee palette as the default `:root` (the app's actual identity, not a `prefers-color-scheme` fallback), with a full accessible light variant gated behind `@media (prefers-color-scheme: light)` since a toggle UI was never decided. Every shadcn semantic token (`--background`, `--card`, `--primary`, `--destructive`, `--border`, `--ring`, `--sidebar-*`, etc.) is mapped to the decided palette; `--win`/`--win-foreground` added as extra tokens outside shadcn's default set since winner-marking isn't one of shadcn's built-in semantics, exposed as `--color-win` so `bg-win`/`text-win` utilities work. `--color-rust` aliases `--color-primary` so components can reach for the name the design is actually discussed in. Radius token set to `0.625rem` with the standard `sm/md/lg/xl` scale, landing buttons at 8px and cards at 10px, close to the decided 6px/10px split. `prefers-reduced-motion` handled globally. Visible focus ring wired at the base layer (`:focus-visible`), not left to per-component defaults.

Fonts wired in `app/layout.tsx` via `next/font/google`: Fraunces (`--font-fraunces`), Inter (`--font-inter`), JetBrains Mono (`--font-jetbrains-mono`), replacing the default Geist pair, mapped to `--font-display`/`--font-sans`/`--font-mono` in the `@theme inline` block.

`app/page.tsx` replaced the stock create-next-app placeholder (which hardcoded zinc/black/white, directly violating the no-neutral-gray rule) with a small themed placeholder that actually exercises the token system end to end: the win-tally signature element (`4 of 5` in Fraunces next to rust tick marks), a primary rust button, mono-set eyebrow label. This is not Feature 5/6's real arena UI, just enough to prove the design foundation renders correctly; it gets replaced when those features build the real screens.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, and `next build` all pass clean. Dev server boots and `/` returns a real `200` with the new font-variable classes and token-driven markup present in the server-rendered HTML.

**Not verified:** actual visual/contrast check in a real browser (no browser automation or screenshot tool available in this environment, and CLAUDE.md rules out installing one). The rust-vs-background contrast risk called out above still needs a real by-eye check from the human — dev server (`pnpm run dev`) is running at `http://localhost:3000`.

- [x] Decide the approach
- [x] Build it

## Slice 1: Core arena loop

### 5. Model picker

An "Add model" popover pulling OpenRouter's live free-tier list, sorted by context window, capped at three models, defaulting to all three selected, with removable chips next to the prompt box. Also render that same catalog as a simple `/models` page, name, context window, and pricing for each one, so anyone can browse the full list without opening the picker.

- [ ] Decide the approach
- [ ] Build it

### 6. Send a prompt, parallel streams, and voting

The heart of the product. One prompt goes to every selected model at once, each streaming and failing independently, so one being slow or down never blocks the others. Each answer shows its own real time-to-first-token, tokens per second, and total tokens. No cost shown, every model here is free tier, so it would always read zero. A vote only exists once two or more models have answered, and picking one writes exactly one vote and marks that answer as the winner, while every answer stays visible the whole time. A follow-up continues each model's own separate conversation.

Arcjet sits in front of this endpoint before any model is ever called: rate limiting, bot protection, and a shield against prompt injection, plus a real limit on how much one person can use across all three models at once, not just a limit on the endpoint overall.

**Done ahead of the rest of this feature:** the Arcjet piece above is live on `/api/chat` — see the Feature 1 note for the rules and verification. It was pulled forward because `lib/arcjet.ts` was already scaffolded and the endpoint it protects already exists; the model-picker fan-out, voting, and PostHog funnel/LLM-analytics pieces below are still open.

Every prompt sent, every answer finishing, and every vote cast should be tracked as a real PostHog event, so there's an honest funnel from prompt to answer to vote. A model failing should also be logged properly on the server, not just shown to the user and forgotten. Separately from that funnel, every actual model call should also be wrapped so PostHog captures its own real tokens, cost, and latency per call, that's PostHog's own LLM analytics, not the same thing as the funnel events or the numbers already shown on the response card.

- [ ] Decide the approach
- [ ] Build it

## Slice 2: App shell & thread history

### 7. App shell & thread history

The frame everything else sits inside: a top bar and sidebar that stay in place while the page scrolls, the thread's name, and each model's win record shown right there (shrinking down to a small dot and number if it gets crowded). The sidebar lists a signed-in user's own past threads so the tool actually feels usable across visits, not just in one sitting.

**Decided:** built the real shell (`components/app-shell/`) at `/arena`, grounded in `docs/ui-sketch/chat-interface.png` for structure only, restyled in the Feature 4 token system rather than the sketch's literal look. `AppShell` is a client component holding sidebar-collapse state; `Sidebar` and `TopBar` are its children. Sidebar: wordmark, nav (Arena/Leaderboard/Models), a "Your Threads" section, user avatar, theme-toggle icon. Top bar: sticky, sidebar-toggle button, breadcrumb, per-model win badges that drop their initial letter on narrow widths (colored dot + count stays), the literal "shrinking down if it gets crowded" behavior from the spec text above.

What's real vs. placeholder: the sidebar-collapse toggle actually works (client state), and Sidebar nav now links to real routes with active-state highlighting via `usePathname` (`Sidebar` is a client component for this reason). `/leaderboard` and `/models` were also built as standalone pages so the nav actually goes somewhere — a static table (grounded in `docs/ui-sketch/leaderboard.png`) and a static card grid (grounded in `docs/ui-sketch/model-page.png`) respectively, both with placeholder data, not real votes or a real OpenRouter catalog. That placeholder content previews what Feature 9 (leaderboard) and Feature 5 (model picker/catalog) will make real later; Feature 7 itself is just the shell frame those pages sit inside. One correction against the leaderboard sketch: it shows a bare `71%` as the big bold number — that directly contradicts the win-rate rule already decided under Feature 9 ("always written as 'won 4 of 5,' never a bare percentage"), so the written rule won, not the sketch, and the big number is "Won 507 of 700" instead. The thread list, sign-in button, theme toggle, model win-record numbers, prompt box, and model chips are all still static, non-functional placeholder content — no real Clerk session, no real thread data, no live model catalog. The theme toggle stays inert on purpose: Feature 4 decided dark is the app's real identity with light as an accessibility fallback via `prefers-color-scheme`, not a user-facing toggle, so wiring one up would be new, undecided scope, not part of this feature.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, and `next build` all pass clean. Dev server boots and `/arena` returns a real `200`.

- [x] Decide the approach
- [x] Build it

## Slice 3: Public visibility & sharing

### 8. Public thread visibility & sharing

Anyone should be able to open a thread's link and see it, without an account, that's what actually makes it shareable. Only sending a prompt and voting need sign-in. A made-up or deleted thread just shows a plain not-found page either way. The thread's real owner sees everything everyone else sees, plus the ability to actually use it.

- [ ] Decide the approach
- [ ] Build it

## Slice 4: Leaderboard

### 9. Leaderboard: global & personal

Two leaderboards from the same votes, one for everyone, one just for the signed-in user. Each row's win rate is the big, bold number, in the accent color, with a small bar next to it, always written as "won 4 of 5," never a bare percentage or a made-up score. Smaller, quieter numbers underneath for average speed and time-to-first-token, each clearly labeled. No cost or "cheapest" stat, every model is free, so that number never means anything here. First place gets a subtle highlight, nobody else does.

- [ ] Decide the approach
- [ ] Build it

## Not doing right now

Kept here so the plan stays honest about what's deliberately left out.

- A "fastest" label on the leaderboard, tagging whichever model already has the best average speed, only for models with enough votes to mean anything. Nice to have, not required.
- Giving each model's own little icon a distinct look instead of plain gray. Nice to have, not required.
- Privacy policy and terms pages.
- Rich link previews when a thread gets shared somewhere.
- Any kind of admin or moderation page.
- A public API for the leaderboard data. Nobody's asked for this.
