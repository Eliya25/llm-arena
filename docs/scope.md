# Scope: LLM Arena

Send one prompt, watch up to three AI models answer it at the same time, and vote for the best one. Over time those votes and the real per-call numbers, speed, tokens, cost, build an honest leaderboard of which model is actually worth using.

Build it in a thin, working slice first, one prompt actually reaching a model and coming back, before making any single part of it fuller. Then thicken it piece by piece. Before building anything, decide what you're doing and why in a few plain sentences, then build it, and if the plan turns out wrong once it's actually built, say so and fix the plan too, not just the code.

Whenever a "build it" style step actually gets underway, break it into its own short list of what's genuinely being done, and check each part off as it's finished, right in this file. That way this file can be opened fresh, in a brand new conversation, and it's obvious what's already done and what's still left, without anyone re-explaining the feature from scratch.

## Stack

Already decided, nothing open here: Next.js (App Router), TypeScript, Tailwind, shadcn for components (card, button, popover, loading skeleton, and whatever else the UI actually needs as it gets built), Prisma with Postgres, Clerk for auth, Arcjet in front of the endpoint, PostHog for analytics and observability.

## Sketches

There are rough hand-drawn sketches for the arena screen, the leaderboard, and the models page. Treat them as structure only, where things sit, what exists on the page, not as the final design or the actual colors, all of that is already decided elsewhere in this file. If something in a sketch genuinely contradicts what's written here, stop and ask which one actually wins rather than guessing.

## At a glance

| #   | Feature                                     | Phase      | Status                     |
| --- | ------------------------------------------- | ---------- | -------------------------- |
| 1   | Connecting to a model                       | Foundation | done                       |
| 2   | Coding standards & tooling                  | Foundation | done                       |
| 3   | Data model                                  | Foundation | done                       |
| 4   | Design & look                               | Foundation | done                       |
| 5   | Model picker                                | Slice 1    | done                       |
| 6   | Send a prompt, parallel streams, and voting | Slice 1    | done                       |
| 7   | App shell & thread history                  | Slice 2    | done                       |
| 8   | Public thread visibility & sharing          | Slice 3    | done                       |
| 9   | Leaderboard: global & personal              | Slice 4    | built, awaiting live check |
| 10  | Abuse protection after public sharing       | Slice 3    | done                       |
| 11  | Starting a new chat                         | Slice 2    | built, awaiting live check |

## Foundation

### Visual refinement pass (2026-08-11)

Refined the existing scorecard/instrument-panel direction into a warmer “judge's desk” interface: stronger surface hierarchy, quieter measurement grid, more confident display typography, a clearer responsive shell, elevated comparison lanes, and a more deliberate composer. The New chat action is now the sidebar's unmistakable reset control, with a filled rust treatment, compact plus mark, and desktop shortcut hint. The established color semantics remain unchanged: rust for interaction, green only for winners, red only for errors.

- [x] Review the existing scope, sketches, and implemented screens
- [x] Refine global surfaces, hierarchy, typography, focus, and selection details
- [x] Redesign the New chat action and improve responsive sidebar behavior
- [x] Improve the arena empty state, answer lanes, and prompt composer
- [x] Polish the leaderboard and model catalog page hierarchy
- [ ] Verify the complete visual pass in a real browser

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

**Changed (2026-08-10):** the original decision here was "no user-facing theme toggle, light mode only via `prefers-color-scheme`" — the user explicitly overruled that and asked for a working light/dark button, so the plan changed, not just the code. Theming is now class-based via `next-themes` (`attribute="class"`, system preference as the default, an explicit choice persisted): `:root` stays the dark coffee identity, `:root.light` carries the light palette, the old `@media (prefers-color-scheme: light)` block is gone since next-themes resolves the system preference before first paint. The toggle itself lives in the sidebar (`ThemeToggle` in `components/app-shell/sidebar.tsx`, sun/moon icon, hydration-safe via `useSyncExternalStore` mounted guard). Also, `app/page.tsx`'s token-preview placeholder served its purpose and is gone — `/` now just redirects to `/arena`, the app's real home screen.

- [x] Decide the approach
- [x] Build it

## Slice 1: Core arena loop

### 5. Model picker

An "Add model" popover pulling OpenRouter's live free-tier list, sorted by context window, capped at three models, defaulting to all three selected, with removable chips next to the prompt box. Also render that same catalog as a simple `/models` page, name, context window, and pricing for each one, so anyone can browse the full list without opening the picker.

**Decided and built:** `lib/openrouter.ts` exports one function, `getFreeModelCatalog()`, that calls OpenRouter's public `GET /api/v1/models` (no API key required for this endpoint), filters to `pricing.prompt === "0" && pricing.completion === "0"`, normalizes to `{ id, name, contextWindow }`, and sorts by context window descending. Cached with `next: { revalidate: 3600 }` since the catalog doesn't meaningfully change minute to minute — refetching OpenRouter on every page load would be wasteful. On any fetch failure it returns `[]` rather than throwing, so callers show a plain "couldn't load models right now" message instead of a raw error, per the CLAUDE.md error rule.

Both `/models` and `/arena` are server components, so each calls `getFreeModelCatalog()` directly — no internal API route was added for this, since nothing else needs the catalog yet and a route would just be an extra network hop with nothing behind it.

`/models` now renders the real fetched list in the existing card layout (initial letter, name, context window, `$0.0000 / M tokens` pricing always shown per the "every model is free, show it anyway" rule), with an empty-catalog fallback message.

`/arena`'s prompt box became a client component, `components/arena/prompt-box.tsx`, taking the server-fetched catalog as a prop. Selection is local `useState<string[]>`, capped at 3, defaulting to the top 3 by context window (the catalog's own sort order). The "Add model" button opens a shadcn `Popover` + `Command` list (id, context window per row, a checkmark on selected rows); once at the cap, unselected rows are disabled rather than clickable, and the trigger button itself disables too. Chips next to the prompt box carry their own remove (`X`) button. No persistence beyond the page session — sending the selection as part of an actual prompt is Feature 6's job, not this one's. The arena page no longer feeds fake win-record numbers into the top-bar model badges (`AppShell`'s `models` prop was dropped from this page) — that placeholder data was tied to specific fake model names that don't line up with the real catalog, and real win records are Feature 9's job, not this one's.

shadcn additions: `popover` and `command` (plus their transitive `button`, `input`, `textarea`, `dialog`, `input-group` files the CLI pulled in). One wrinkle: this project's shadcn style (`base-nova`) is built on `@base-ui/react`, not Radix — the CLI's own dependency install step failed here on a pnpm store-location mismatch (`ERR_PNPM_UNEXPECTED_STORE`, this machine's pnpm store lives at a non-default path), so the dependency had to be installed by hand first (`pnpm add @base-ui/react --store-dir ...`) before re-running `npx shadcn add`. Also, Base UI's trigger components don't use Radix's `asChild` pattern — they render their own native element directly and take `className`/`disabled` straight as props, which is how `PopoverTrigger` ended up wired in `prompt-box.tsx`.

**Fixed (2026-08-10):** the price-only filter let non-chat models into the catalog — Google's Lyria (music generation) models are free and were landing as two of the three defaults, failing every prompt with "The model didn't respond." The filter now also requires text input and _exactly_ `["text"]` as the output modalities, since media models list text among their outputs too, which is why a looser "outputs text" check wouldn't have caught them. Also stripped the "(free)" name suffix (every model here is free, the page already says so). The "Add model" button no longer sits dead and disabled at the three-model cap (that confusion was reported directly) — it first shipped as simply hidden at the cap, then per an explicit follow-up request it became a "Change models" button instead: same searchable list, unticking a selected model frees a slot and keeps the list open, ticking a new one completes the change and closes it. Pressing a chip directly still swaps just that one model. Lane metrics footer no longer renders a "— · — · —" wall: only measured numbers appear, a streaming lane with nothing yet says "waiting for first token…", and error lanes show just the message and Retry.

**Added (2026-08-10, user request):** each selected-model chip is itself pressable, not just removable — pressing it opens the same searchable catalog list and picking a model swaps that chip in place (models already selected elsewhere are disabled in the swap list; the chip's own model shows the checkmark). The list markup is one shared `ModelCommandList` component used by both the chips and the "Add model" button, per the no-copy-paste rule; the picker-open state moved inside `PromptBox` (one `openPicker: chipId | "add" | null` instead of a bool per popover). A hint line under the prompt box says a model can be pressed to swap it.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, and `next build` all pass clean. Dev server confirmed both routes return real `200`s with live OpenRouter data server-rendered into the HTML — `/models` lists real free-tier models (e.g. "Google: Lyria 3 Pro Preview", "NVIDIA: Nemotron 3 Ultra (free)"), and `/arena` renders exactly 3 default-selected chips with "Add model" correctly `disabled` at the cap. Popover open/toggle interactivity itself couldn't be verified through `curl` (client-side React), but the data wiring, cap logic, and disabled states are confirmed correct server-side.

- [x] Decide the approach
- [x] Build it

### 6. Send a prompt, parallel streams, and voting

The heart of the product. One prompt goes to every selected model at once, each streaming and failing independently, so one being slow or down never blocks the others. Each answer shows its own real time-to-first-token, tokens per second, and total tokens. No cost shown, every model here is free tier, so it would always read zero. A vote only exists once two or more models have answered, and picking one writes exactly one vote and marks that answer as the winner, while every answer stays visible the whole time. A follow-up continues each model's own separate conversation.

Arcjet sits in front of this endpoint before any model is ever called: rate limiting, bot protection, and a shield against prompt injection, plus a real limit on how much one person can use across all three models at once, not just a limit on the endpoint overall.

**Done ahead of the rest of this feature:** the Arcjet piece above is live on `/api/chat` — see the Feature 1 note for the rules and verification. It was pulled forward because `lib/arcjet.ts` was already scaffolded and the endpoint it protects already exists; the model-picker fan-out, voting, and PostHog funnel/LLM-analytics pieces below are still open.

Every prompt sent, every answer finishing, and every vote cast should be tracked as a real PostHog event, so there's an honest funnel from prompt to answer to vote. A model failing should also be logged properly on the server, not just shown to the user and forgotten. Separately from that funnel, every actual model call should also be wrapped so PostHog captures its own real tokens, cost, and latency per call, that's PostHog's own LLM analytics, not the same thing as the funnel events or the numbers already shown on the response card.

**Decided and partly built (2026-08-10):** the interactive core is real. `components/arena/arena-client.tsx` owns the whole loop: the prompt box actually sends (Enter to send, shift+Enter for a newline), the prompt fans out to one independent `POST /api/chat` fetch per selected model, and each lane parses its own SSE stream — accumulating delta text live with a blinking caret, measuring real time-to-first-token client-side, and reading real token counts from OpenRouter's usage block (the route now sends `usage: {include: true}` so counts are measured, never estimated; tokens/sec is computed from completion tokens over the streaming window, and any metric that didn't arrive shows "—" rather than a made-up number). Lanes fail independently: an error lane shows the server's plain-language message with its own Retry button and never touches the other lanes. Voting follows the rule above — "Pick as winner" buttons only appear once two or more lanes have finished; picking one marks it with the green winner badge and border while the other lanes dim, and every answer stays visible. `PromptBox` became a controlled component under `ArenaClient`; selection state moved up with it.

Funnel events wired client-side: `arena_prompt_sent`, `arena_answer_finished` (with ttft/tok-s/tokens), `arena_vote_cast`, alongside the existing server-side `prompt_submitted` / `model_response_received` / `model_response_failed`.

**Persistence half built (2026-08-10):** `app/arena/actions.ts` holds the server actions — `createTurn` (upserts the Clerk user, creates the thread on first send with the prompt's first 80 chars as its title, then the turn plus one pending message row per model, returning model→messageId), `completeMessage`/`failMessage` (each verifies through the relation chain that the row belongs to the caller before writing content, metrics, and status), and `castVote` (server-enforces the real rule — the turn is the caller's, unvoted, the picked message actually succeeded, and two or more messages succeeded — then writes the one vote; the `@unique` on `turnId` makes a double-vote impossible at the database level, and the server also captures the `vote_cast` funnel event). Every action returns plain-language `{ error }` objects, never a raw exception.

Client side, `ArenaClient` became multi-turn: turns stack in one scrollable column, each with its own lanes, winner state, and vote. The database write runs _alongside_ the streams, never in front of them — a slow write can't delay the first token; each lane awaits the shared `createTurn` promise only at its end to learn its messageId. If saving fails, the turn says so plainly and voting is disabled for it while the answers still work. Follow-ups are real separate conversations: each model's history is rebuilt from its own prior answers only (a model that failed a turn just doesn't get that assistant message), and `/api/chat` now takes `{ model, messages }` with shape validation (max 40 messages, 32k chars each, must end with a user message; Arcjet's prompt-injection check runs on the latest user message). Sending and voting now require sign-in — already decided under Feature 8 ("only sending a prompt and voting need sign-in"), and forced here anyway since a thread must belong to someone; a signed-out send opens the Clerk modal instead.

PostHog LLM analytics: the route tees the upstream SSE stream — one copy to the browser, one parsed server-side for prompt/completion token usage — and captures a `$ai_generation` event per model call with provider, model, real token counts, measured latency, and `$ai_total_cost_usd: 0` (honest — every model is free tier).

The sign-in rule is enforced at the endpoint too, not just in the browser — `/api/chat` returns a plain-language `401` to signed-out callers, so the Feature 8 rule ("only sending a prompt and voting need sign-in") holds even against direct requests.

**Refined (2026-08-11, user request):** metrics now tick _while_ a lane streams, not just after it finishes — Feature 4 already promised "a live-ticking tokens/sec readout" but only time-to-first-token was actually live. This refines the "measured, never estimated" rule rather than breaking it: during streaming the readout shows `~N tok/s` and `~N tokens` estimated from streamed characters (÷4) over the measured elapsed window, with the `~` making the approximation visible; the rate holds for the first half-second so early chunks don't flash a wild number. The moment the stream ends, the estimates are cleared and only the exact usage-based numbers remain — every _resting_ number is still a real measurement, and nothing persisted to the database ever comes from an estimate.

**Fixed (2026-08-10, user report):** a slow model was holding the next message hostage — the prompt box stayed disabled until the slowest lane finished, and a stalled stream could block it forever, making follow-ups feel broken. Three changes: the prompt box is never disabled (sending a new message cleanly aborts any lane still streaming, which then reads "Stopped so your next message could go out"); every stream has a 60-second no-progress watchdog (`AbortController` + a stall timer reset on each chunk) that ends a silent lane with "The model took too long to respond." and a Retry instead of hanging; and follow-up history content is trimmed client-side to the server's 32k per-message cap so one giant answer can't fail the whole next turn with a confusing validation error.

**Resolved:** turns reloading after a refresh is now built — Feature 7's thread history. PostHog session replay/heatmap flags from Feature 1's wishlist remain separate from this.

**Verification honesty:** `tsc`, `eslint`, `prettier`, `next build` all pass, but none of them _execute_ the new write path — the server actions require a real signed-in Clerk session, which the terminal can't produce (Arcjet also denies `curl` as a bot). The feature stayed "awaiting live check" until a real browser session sent a prompt and voted.

**Live check passed (2026-08-11):** the user ran real sessions in the browser, and a one-off SQL query against the real database confirmed the full chain landed: 1 user, 4 threads, 8 turns, 24 messages, 6 votes. Real metrics on the rows (measured ttft/tok-s/token counts), exactly one winner per voted turn, follow-up turns in the same thread, and honest `PENDING` rows where a stream never finished. One observation for later, not a defect blocking this feature: one `SUCCESS` message has 79 tokens of usage but zero content characters and no ttft — a model that reported usage without ever streaming visible text (likely reasoning-only output). If it recurs it's worth deciding whether such an answer should count as answered for voting purposes.

- [x] Decide the approach
- [x] Build it
- [x] Live browser check + database row confirmation

## Slice 2: App shell & thread history

### 7. App shell & thread history

The frame everything else sits inside: a top bar and sidebar that stay in place while the page scrolls, the thread's name, and each model's win record shown right there (shrinking down to a small dot and number if it gets crowded). The sidebar lists a signed-in user's own past threads so the tool actually feels usable across visits, not just in one sitting.

**Decided:** built the real shell (`components/app-shell/`) at `/arena`, grounded in `docs/ui-sketch/chat-interface.png` for structure only, restyled in the Feature 4 token system rather than the sketch's literal look. `AppShell` is a client component holding sidebar-collapse state; `Sidebar` and `TopBar` are its children. Sidebar: wordmark, nav (Arena/Leaderboard/Models), a "Your Threads" section, user avatar, theme-toggle icon. Top bar: sticky, sidebar-toggle button, breadcrumb, per-model win badges that drop their initial letter on narrow widths (colored dot + count stays), the literal "shrinking down if it gets crowded" behavior from the spec text above.

What's real vs. placeholder: the sidebar-collapse toggle actually works (client state), and Sidebar nav now links to real routes with active-state highlighting via `usePathname` (`Sidebar` is a client component for this reason). `/leaderboard` and `/models` were also built as standalone pages so the nav actually goes somewhere — a static table (grounded in `docs/ui-sketch/leaderboard.png`) and a static card grid (grounded in `docs/ui-sketch/model-page.png`) respectively, both with placeholder data, not real votes or a real OpenRouter catalog. That placeholder content previews what Feature 9 (leaderboard) and Feature 5 (model picker/catalog) will make real later; Feature 7 itself is just the shell frame those pages sit inside. One correction against the leaderboard sketch: it shows a bare `71%` as the big bold number — that directly contradicts the win-rate rule already decided under Feature 9 ("always written as 'won 4 of 5,' never a bare percentage"), so the written rule won, not the sketch, and the big number is "Won 507 of 700" instead. The thread list, sign-in button, theme toggle, model win-record numbers, prompt box, and model chips were all static placeholder content at first.

**Update (2026-08-10):** the sidebar's auth is now real — `SignInButton` (Clerk modal) when signed out, `UserButton` and a signed-in threads message when signed in, switched on `useUser().isSignedIn` (Clerk v7 no longer exports `SignedIn`/`SignedOut` components, hence the hook). The theme toggle is also real now (see the Feature 4 change note). Still placeholder: the thread list itself ("No threads yet" copy, no real rows) and the top-bar win badges — both wait on the Feature 6 persistence work, since threads and win records don't exist as data until turns and votes are written to the database.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, and `next build` all pass clean. Dev server boots and `/arena` returns a real `200`.

**Thread history — decided (2026-08-10), not yet built.** This is the open half of this feature: the sidebar's real thread list, and a thread actually coming back after a refresh. The plan:

- **Routes:** `/arena` stays the fresh-arena page (a new thread is created on first send, as today). An existing thread lives at `/arena/[threadId]` — a server component that loads the thread with its turns → messages → vote (ordered by creation), owner-only for now, `notFound()` for a missing or someone-else's thread. This same URL becomes the shareable public link in Feature 8 (which will relax owner-only to public-read), so the route shape is chosen with that in mind.
- **URL after first send:** when `createTurn` creates the thread, the client updates the address bar with `window.history.replaceState` to `/arena/<id>` — deliberately _not_ a Next.js navigation, because navigating would swap the page tree and kill the in-flight streams. A later refresh or revisit then lands on the server-rendered thread page.
- **Restoring turns:** `ArenaClient` grows `initialThreadId` / `initialTurns` props; the thread page maps the persisted rows into the existing `TurnView`/`Lane` shape. Each restored lane must carry its `messageId` and each turn its `turnId`, because voting on a reloaded, still-unvoted turn (two-plus `SUCCESS` lanes) has to work — that's part of the feature, not a nice-to-have. Follow-ups pass the existing `threadId` to `createTurn` (already supported) and rebuild each model's history from persisted content. A row still `PENDING` on reload (tab closed mid-stream) renders as a plain "didn't finish" lane — honest, not fake-streaming, no Retry since its stream is gone.
- **Two known traps, handled up front:** (1) `router.refresh()` while lanes are still streaming can remount the client mid-stream once the URL points at the `[threadId]` route — so the sidebar-updating refresh waits until all lanes have settled, never fires alongside them. (2) Navigating thread A → thread B reuses the same client component instance, so `ArenaClient` gets `key={threadId}` to force clean state per thread.
- **Sidebar thread list:** a shared server-side query (id, title, most-recent first) for the signed-in user's threads, fetched in each page's server component and passed down through `AppShell` → `Sidebar`; rows link to `/arena/[threadId]` with active-state highlight, signed-out and empty states keep the existing copy. The deferred `router.refresh()` above is what makes a brand-new thread appear in the list.
- **Top-bar win badges:** made real on the thread page, scoped to _that thread_ — each participating model's votes won across the thread's turns. Global win records are Feature 9's job, not this one's; deciding thread-scoped here keeps the two features from overlapping.
- **Design note:** this is UI work (thread list rows, restored-turn rendering), so per CLAUDE.md the `frontend-design` skill gets invoked when building — even though it's largely populating already-designed components.

**Built (2026-08-10), with one deliberate deviation from the plan above.** The deviation: the plan's "deferred `router.refresh()` after all lanes settle" for updating the sidebar was dropped entirely — once `replaceState` has pointed the URL at `/arena/[threadId]`, _any_ `router.refresh()` (deferred or not) resolves against the thread route, swaps in a different page tree, and remounts `ArenaClient`, resetting model selection and any draft follow-up. Instead the thread list lives in a small client context (`components/app-shell/threads-context.tsx`): server-seeded via an `initialThreads` prop on `AppShell`, refreshed by calling the `getOwnThreads()` server action the moment `createTurn` reports a brand-new thread. No remount risk at any point, and the new thread appears in the sidebar immediately rather than after the turn settles.

What landed where: `getOwnThreads()` (id + title, newest first, `[]` on any failure including signed-out) joined the actions in `app/arena/actions.ts` and is fetched by all three shell pages (`/arena`, `/leaderboard`, `/models` — the latter two went dynamic in the build since they now read auth, expected). `app/arena/[threadId]/page.tsx` is the thread page: owner-only (`notFound()` for missing, someone-else's, or signed-out — one indistinguishable 404), loads turns → messages → vote, maps them to `InitialTurn[]` (model names resolved from the live catalog, falling back to the raw id if a model left the catalog), and renders `ArenaClient` with `key={thread.id}`. Restored turns seed `persistenceRef` with already-resolved promises carrying their `turnId`/`messageIds`, so voting on a reloaded unvoted turn and retrying a reloaded failed lane go through the exact same code path as live ones. A new lane status `"unfinished"` renders a still-`PENDING` row (tab closed mid-stream) as a plain "This answer didn't finish." — muted, no fake caret, no metrics, no Retry. Restored `FAILED` lanes say "This model didn't answer." and do keep Retry. The sidebar renders real thread rows (truncated title, active-state highlight via `usePathname` — which also lights up after a `replaceState`, since Next syncs it), scrolling inside its own section when long. Top-bar badges on the thread page are real and thread-scoped: for each participating model, wins over the thread's _voted_ turns, hidden entirely until at least one vote exists (`0/0` noise says nothing). `app/not-found.tsx` added as the plain themed not-found the thread page's `notFound()` lands on — Feature 8 already required one anyway. `app/error.tsx` added alongside it: the thread page's Prisma query throws straight through on a database failure, and without an error boundary that would surface Next's raw error screen, violating the never-show-a-raw-exception rule — the boundary shows a plain sentence and a "Try again" button wired to `reset()`. Two honest footnotes: sidebar ordering is thread `createdAt` descending, not last-activity (Thread has no `updatedAt` and new turns don't touch the thread row — fine until someone actually notices), and navigating away mid-stream unmounts the lanes but the in-flight fetches still complete and persist, so a turn abandoned that way saves normally rather than landing as "didn't finish."

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build` all pass clean. Against the running dev server: `/arena`, `/leaderboard`, `/models` return `200`; `/arena/doesnotexist` returns a real `404`. Not verifiable from the terminal (needs the same signed-in browser session as Feature 6's pending live check): a real thread page rendering restored turns, the sidebar list populating, the URL swap after first send, and voting on a reloaded turn.

- [x] Decide the approach (shell)
- [x] Build the shell
- [x] Decide the approach (thread history — plan above)
- [x] Build thread history: `/arena/[threadId]` page loading persisted turns
- [x] Build thread history: `replaceState` + `key={threadId}` in `ArenaClient`; sidebar updates via threads context, not `router.refresh()` (see deviation note)
- [x] Build thread history: real sidebar thread list
- [x] Build thread history: thread-scoped top-bar win badges
- [x] Verify: typecheck/lint/build clean, route smoke-checks pass, and the real browser pass done (2026-08-11) — threads restored after refresh, follow-ups continued in the same thread, and the database rows confirm it (see Feature 6's live-check note; e.g. a follow-up turn with two `SUCCESS` lanes and one honest `PENDING` lane sits in the same thread as its voted first turn)

### 11. Starting a new chat

A visible way to start a fresh conversation, the way ChatGPT and Claude both put one at the top of the sidebar. Until now the only route to a blank arena was the "Arena" nav item, which reads as a section to browse rather than an action to take.

**Decided (2026-08-11).** A prominent "New chat" action sits above the nav list, and the "Arena" nav item stays where it is — chosen over renaming "Arena" or dropping it, so the section keeps its name and the action gets a real affordance. It's visible signed-out too, since `/arena` is public and composing a prompt is what opens the sign-in modal; a visitor reading a shared thread can start their own from the same place the read-only note points them.

**The problem worth recording, because it isn't obvious.** This looks like a one-line `<Link href="/arena">` and isn't. Feature 7 deliberately rewrites the URL with `window.history.replaceState` after the first send, so you can sit at `/arena/<id>` while the rendered tree is still the `/arena` page. From that state a link to `/arena` may be reconciled as a same-page navigation: the URL changes, the tree is reused, and the old turns stay on screen — a button that looks alive and does nothing, in the single most common case there is (send a prompt, then start a new chat).

Rather than gamble on client-router behavior that can't be verified from a terminal, the arena hands the sidebar a way to clear itself. `components/app-shell/new-chat-context.tsx` holds a `resetRef` — a ref, not state, because nothing needs to re-render when it changes and the sidebar only reads it at click time. The fresh-arena `ArenaClient` (and only that one — `initialThreadId === null`) registers a reset while mounted. The sidebar's link then does one of two things: if a reset is registered it prevents default, clears in place, and `replaceState`s the address bar back to `/arena`; if not — a real thread page, or any other route — it navigates like an ordinary link. Modified clicks (⌘/Ctrl/Shift/Alt, middle button) are always left to the browser, so open-in-new-tab still works. It stays a real `<a href="/arena">` throughout rather than becoming a `<button>`, so link semantics survive.

**Streams still running are deliberately not aborted.** That's exactly what navigating away already does — Feature 7 records that in-flight fetches complete and persist — so an abandoned turn saves honestly whichever path you took, instead of landing as a misleading "stopped" row. Patches arriving from those streams simply no-op once their turn is gone from state. The model selection also survives a reset on purpose: it's how you've set the app up, not part of the conversation.

**Fixed after code review: the reset left a stale thread identity behind.** `createTurn` runs alongside the streams, so pressing New chat in the window before it resolves left its completion callback live. It would then run `setThreadId(<abandoned thread>)` and `replaceState` the address bar back to `/arena/<abandoned id>` — and because the arena continues whatever `threadId` holds, the _next_ prompt would silently be saved as a follow-up in the conversation the user had just walked away from. Fixed with a `sessionRef` generation counter that the reset bumps: a callback whose session no longer matches skips adopting the thread and skips the URL rewrite. It still calls `refreshThreads()` though — that thread was genuinely created and belongs in the sidebar, so hiding it would be the dishonest half of the fix.

**Design — proposed one way, shipped another.** `frontend-design` was invoked per CLAUDE.md, but the system was already fixed by Feature 4, so the only real choice was weight. The proposal was an **outlined** rust button (`border-primary/40`, `text-primary`, hover fill), on the reasoning that starting over is a reset rather than the app's main move and shouldn't compete with Send and "Pick as winner", the two filled-rust actions. **The user overruled that during the build and made it a filled rust button** (`bg-primary`, `text-primary-foreground`, `soft-shadow`, semibold) — recorded here rather than quietly reworded, since it changes the accent hierarchy the outline reasoning was protecting: New chat now reads at the same weight as the app's primary actions, which is a defensible call for the one control that starts everything.

As shipped: a `Plus` icon inside a small translucent chip rather than the proposed `SquarePen`, a `⌘K` hint badge on the right at `md` and up, and the label hidden below `md` so the sidebar collapses to icons on narrow screens on its own (`w-16 md:w-64`) in addition to the manual collapse toggle. Nav rows and this button share one `SIDEBAR_ROW` constant for their geometry, per the no-copy-paste rule, so their icons line up on a single grid; collapsed, the label goes `sr-only` and `title` supplies the tooltip. A broader visual pass landed alongside this (grid texture behind the main area, an "A" wordmark chip, a rust active-indicator bar on nav rows) — Feature 4's palette and rules are unchanged, so it's a refinement within the existing system rather than a new direction.

**Known gap, not shipped working: the `⌘K` badge is decorative.** There is no keyboard handler bound to it anywhere in the app — the only `metaKey` reference in the codebase is the modified-click guard on this very link. The badge currently advertises a shortcut that does nothing, which is the kind of promise the error-handling rule elsewhere in this project would not tolerate. Either wire it up or drop the badge; it should not stay as-is.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build` all clean. Against the running dev server, the button server-renders on all four shell pages — `/arena`, `/leaderboard`, `/models`, and a signed-out public thread — as a real `<a href="/arena">` with the rust outline classes and an `aria-hidden` icon beside a visible text label. DOM order confirms it sits above the nav (New chat → Leaderboard → Your threads).

**Not verifiable from the terminal:** the click behavior itself is entirely client-side, and the case that motivated the whole design — send a prompt, then press New chat — needs a signed-in browser session. The reset path is the one that runs there, so that is the path to check.

- [x] Decide the approach
- [x] Build it: `new-chat-context.tsx`, provider in `AppShell`, reset registered by the fresh-arena `ArenaClient`
- [x] Build it: the sidebar action, shared `SIDEBAR_ROW` geometry, collapsed state
- [x] Verify: checks clean, renders on every shell page in the right position
- [ ] Live check: send a prompt, press New chat, confirm the turns clear and the URL returns to `/arena`
- [ ] Live check: press New chat from a thread page and from the collapsed sidebar
- [ ] Decide the `⌘K` badge: wire the shortcut, or remove the badge — it currently does nothing

## Slice 3: Public visibility & sharing

### 8. Public thread visibility & sharing

Anyone should be able to open a thread's link and see it, without an account, that's what actually makes it shareable. Only sending a prompt and voting need sign-in. A made-up or deleted thread just shows a plain not-found page either way. The thread's real owner sees everything everyone else sees, plus the ability to actually use it.

**Decided (2026-08-11), not yet built.** The plan:

- **Public by link, no toggle.** The spec text above already decides this: a thread's URL _is_ the share mechanism. Every thread is readable at `/arena/[threadId]` by anyone, signed in or not; the cuid id is unguessable enough to serve as the capability. No visibility flag, no schema change, no share/unshare UI to maintain. A missing or deleted thread hits the existing plain not-found page for everyone equally.
- **The read path opens up; the write path doesn't move an inch.** `app/arena/[threadId]/page.tsx` drops the owner filter from its query and instead computes `isOwner` (Clerk `userId` matches the thread's owner — `false` when signed out). Nothing changes server-side for writes, because Feature 6 already built them owner-enforced: `createTurn`, `completeMessage`, `failMessage`, and `castVote` each verify ownership through the relation chain and `/api/chat` already returns a plain 401 to signed-out callers. Public reading rides on writes that were never trusting the client anyway.
- **One component, a `readOnly` prop — not a second thread view.** `ArenaClient` gets `readOnly?: boolean`. When set: no prompt box, no "Pick as winner", no Retry — just the turns, lanes, winner badges, and real metrics, rendered by the exact same code the owner sees (per the no-copy-paste rule; a forked read-only component would drift). The owner keeps today's full experience. Restored `PENDING`/`FAILED` lanes stay honest in both views.
- **A visible face for sharing: "Copy link".** A small copy-link button in the top bar on thread pages (owner and visitors alike — visitors can pass a link on too), with a brief "Copied" confirmation. Clipboard is the whole feature; rich link previews stay deliberately out (already in "Not doing right now").
- **A real `<title>` for shared links:** `generateMetadata` on the thread page sets the thread title, so a pasted link reads as something, even without rich previews.
- **Signed-out shell already behaves:** the sidebar shows the sign-in prompt and no threads, and a visitor's way into using the app (the arena, sign-in) is one click away. No changes needed there.
- **Verification:** typecheck/lint/format/build, then `curl` a real thread URL signed-out and confirm a `200` with the turns server-rendered (this becomes terminal-verifiable for the first time, since reading no longer needs a session); a made-up id still `404`s; the browser pass covers the read-only view showing no send/vote controls and copy-link working.

**Built (2026-08-11), exactly per the plan above.** The thread page's query became `findUnique` by id (no owner filter), wrapped in React's `cache()` so the new `generateMetadata` (thread title as the page `<title>`) shares one query with the page render. `isOwner` compares the thread owner's `clerkId` against the Clerk session (`false` signed-out) and drives `readOnly` on `ArenaClient`: read-only hides the prompt box (replaced with "You're viewing a shared thread. Start your own in the arena"), the vote buttons, and Retry — everything else (turns, lanes, winner badges, real metrics, honest `PENDING`/`FAILED` lanes) renders through the same code the owner sees. The copy-link button lives in `TopBar` (now explicitly `"use client"`, it holds copied-state), shown only on thread pages via `showCopyLink` on `AppShell`; it copies `window.location.href` with a 2-second "Copied" confirmation, and a clipboard failure silently does nothing since the address bar still has the link. No server action changed — the write path was already owner-enforced from Feature 6. One known seam, a consequence of Feature 7's `replaceState` design and fine to ship: right after the _first_ send in a fresh arena, the URL already reads `/arena/<id>` but the rendered tree is still the `/arena` page, so the copy-link button only appears after a reload or a revisit from the sidebar — not a bug to rediscover later. Also by design: the owner viewing their own thread signed out gets the read-only view, exactly what "only sending and voting need sign-in" implies. The owner's `clerkId` never serializes to the client — `isOwner` is computed server-side and only the boolean travels.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build` all clean. Signed-out `curl` of a real thread returns `200` with the turns, metrics, winner badge, real `<title>`, copy-link button, and the shared-thread note all server-rendered, and zero "Pick as winner" buttons; a made-up id returns `404`. Still needs the human browser pass: copy-link actually writing to the clipboard, and an incognito window confirming the read-only view end to end.

- [x] Decide the approach
- [x] Build it: public read + `isOwner` on the thread page
- [x] Build it: `readOnly` mode in `ArenaClient`
- [x] Build it: copy-link button + `generateMetadata`
- [x] Verify: checks + signed-out `curl` of a real thread (200, read-only, real title) and fake id (404)
- [x] Live check passed (2026-08-11): the user copied a thread link and opened it in a different browser — the shared chat rendered, confirming copy-link and the public read-only view end to end

**Follow-up:** opening the read path changed what can be abused — an unauthenticated database read per link, uncapped write actions, and PII that becomes permanently public with no unshare path. That's Feature 10, which re-matches Arcjet to the surface this feature created.

### 10. Abuse protection after public sharing

Feature 8 made every thread readable by anyone holding its link. That changed the app's exposure in ways the existing Arcjet setup didn't cover, so this feature re-matches protection to the surface that actually exists now.

**What was already there, for the record:** one request-based client (`@arcjet/next`) in `lib/arcjet.ts`, applied at exactly one place — `POST /api/chat` — with `shield`, `detectBot` (`allow: []`), `detectPromptInjection`, and a `tokenBucket` (refill 5 / 10s, capacity 10) keyed by the `userId` characteristic. Nothing else in the app touched Arcjet.

**What sharing actually opened up, and the verdict on each:**

- **The public thread page is an unauthenticated database read.** `/arena/[threadId]` runs a `findUnique` with the full turns → messages → vote include on every request, with no auth and no limit — anyone with a link can hammer it. **Protected.**
- **The server actions had no rate limit.** `createTurn`, `completeMessage`, `failMessage`, and `castVote` were owner-enforced from Feature 6 but uncapped, so a scripted signed-in client could flood threads, turns, and messages while entirely bypassing `/api/chat`'s bucket. **Protected.**
- **PII in a prompt is now permanently public.** No unshare path exists, by design. **Protected, narrowly — card numbers only.**
- **`completeMessage` still writes client-supplied content and metrics.** A signed-in user can publish arbitrary text at a shareable URL with no model involved, and feed fabricated ttft/tok-s numbers into the global leaderboard. Rate limiting caps the volume, but the trust problem itself is **not an Arcjet rule** and is deliberately still open — recorded here rather than quietly ignored.

**Ruled out, each with a reason:**

- **`detectBot` on the public thread page** — `allow: []` there would block the crawlers and link unfurlers that make a shared link worth sharing. It would defeat Feature 8 rather than protect it. Left off deliberately, which is why the read path needs its own rate limit instead.
- **`validateEmail` / `protectSignup`** — Clerk owns signup entirely; there's no auth form in this codebase to protect.
- **`filter` (IP / VPN / geo)** — no abuse observed and no code needed today; it can be pushed as a _remote_ rule from the Arcjet CLI during an incident, which is the right time to decide it.
- **The Guard SDK and `experimental_moderateContent`** — Guard is for non-HTTP code, and this app has none: no queues, no workers, no MCP server, everything runs in a route handler or a server action. Worth naming the real consequence though: public sharing turned "someone posts something ugly at a public URL" into a live possibility, and "no admin or moderation page" is still in _Not doing right now_. That stays a deliberate gap, not an oversight.
- **`sensitiveInfo` on emails and phone numbers** — rejected as too broad. It would deny legitimate prompts (drafting an email, parsing contact details), and this is a tool for judging model answers, not a vault.
- **A read limit on `/leaderboard` and `/models`** — both are public reads too, and `/leaderboard` is genuinely the same shape as the thread page: an unauthenticated database aggregation anyone can hammer. Left alone on purpose, because the thread page is what public sharing actually created and widening beyond that wasn't the ask. `/models` is cushioned anyway by the catalog's hour-long fetch cache. The `ajPublicRead` client is right there if either ever matters — noted so this is a decision, not an oversight.
- **A rate limit on `getOwnThreads`** — it's a single indexed read, and denying it would blank the sidebar's thread list (the action returns `[]` on failure by design). The downside outweighs the gain. Left uncapped, knowingly.

**Built (2026-08-11).** `lib/arcjet.ts` now exports three clients rather than one. They're deliberately separate rather than one shared client with `withRule()`: the surfaces need different keys (person vs. IP) and different budgets, and a single shared token bucket would make a prompt's own persistence writes eat the streaming quota. Each bucket's configuration is distinct, so Arcjet counts them separately.

- **`aj`** (unchanged, plus one rule) — `/api/chat`. Gained `sensitiveInfo({ mode: "LIVE", deny: ["CREDIT_CARD_NUMBER"] })`, detected locally by the bundled WASM engine with no extra package. The value is passed explicitly as `sensitiveInfoValue` (the latest user message) because the route already consumed the body with `request.json()`, so the deprecated whole-body scan could never have run. Denial maps to a `400` naming the real reason, including _why_ it matters: threads are public by link.
- **`ajActions`** — the server actions. `shield` plus a `tokenBucket` (refill 15 / 10s, capacity 45), keyed per-user. Costs are weighted via `requested` at each call site, which is what a token bucket is for: `createTurn` costs 5 (it writes a thread, a turn, and a row per model), while the single-row updates cost 1. A normal turn spends 5 + 3 + 1 = 9, so the sustained ceiling lands close to `/api/chat`'s own — deliberately, so the streaming limit is what bites first, not persistence.
- **`ajPublicRead`** — the thread page. `shield` plus a `tokenBucket` (refill 20 / 10s, capacity 60) and **no `userId` characteristic**, so it keys by IP, which is the only identity an anonymous visitor has. The budget is deliberately generous because a whole office behind one NAT shares a key.

Two placement details worth recording. First, the gating in `app/arena/actions.ts` runs **before** the user upsert, not after — the upsert is itself a database write, so limiting after it would have left the flood vector wide open. The new `authorize(requested)` helper does sign-in check → rate limit → upsert in that order and returns either the user row or a plain-language error, replacing the old `requireUser()`. Its return type is written out explicitly (`Authorized | ActionError`) rather than inferred: an inferred union puts an optional `error` key on the success branch too, which silently stops `"error" in result` from narrowing.

Second, the thread page is a server component, not a route handler, so `protect()` attaches through `@arcjet/next`'s `request()` helper. Both `generateMetadata` and the page render need the answer, and calling `protect()` in each would spend two tokens per page view — so the check is wrapped in React's `cache()`, exactly like `loadThread` already is. Measured and confirmed: one page view = one Arcjet decision. A denied read renders a plain "Too many requests" screen rather than a raw error or a misleading not-found. One honest limitation: a server component can't set an HTTP status, so that screen returns `200`, not `429`.

That screen was the third copy of the same centered-message layout (`not-found.tsx` and `error.tsx` were the first two), so per the no-copy-paste rule it became `components/message-screen.tsx`, and both existing screens were refactored onto it. The shared action-button classes live there too, as `messageScreenActionClass`.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build` all clean. Against a running dev server, with a real thread id: **the read limit genuinely fires** — 150 parallel requests returned 100 rendered and 50 rate-limited, and the page renders normally again after the bucket refills. (Sequential `curl` never trips it, which is itself a useful signal that the budget isn't too tight for real use.) `allowRead` was instrumented and confirmed to run exactly once per page view, so the `cache()` dedupe works and a view costs one token, not two. Feature 8's read-only behavior is intact — a signed-out fetch of a real thread still renders with zero "Pick as winner" buttons. `/arena`, `/leaderboard`, `/models` return `200`; a made-up thread id still `404`s. `POST /api/chat` returns `401` signed-out, which also proves the new `sensitiveInfo` rule constructs without throwing (an unsupported `deny` entry throws at client construction).

**Live check passed (2026-08-11).** The two things that genuinely couldn't be reached from a terminal — the card-number denial and the server-action limit, both behind a signed-in Clerk session that `detectBot` blocks `curl` from faking — were confirmed by a real browser pass, then read back from the Arcjet site itself (`arcjet auth login` via the device flow, then `requests list --site-id site_01kzksm2t0eqmb532axepsmfay`). The decision timeline says all three plainly:

- **`REASON_SENSITIVE_INFO` / `DENY` on `/api/chat`, five times.** Three of them land in the same millisecond (`19:25:02.383/.384/.384`) — that's one prompt fanning out to three models and _all three_ being blocked before any model was called, which is exactly the intent: the rule sits in front of the fan-out, not behind it.
- **The action limit never bit during real use.** Every `request()`-helper decision interleaved through the browser session (`19:25:02` → `19:25:13`) came back `ALLOW`. The write path ran normally alongside the blocked prompts. This is the "chat's limit should bite first" design holding up against actual traffic rather than a bench test.
- **The read limit fires and recovers.** Eleven `RATE_LIMIT` / `DENY` decisions clustered inside one second (`19:18:53.582` → `19:18:54.28`) are the tail of the 150-parallel flood — the CLI returns only the most recent 25, so the rest were pushed out of the window — and everything from `19:19:23` onward is `ALLOW` again.

One limitation of that read-back, recorded so nobody over-reads it later: both `ajActions` and `ajPublicRead` reach Arcjet through the `request()` helper, which carries no path, and both declare the same two rule types (`shield` + `rate_limit`). So the console can't attribute a `(no path)` decision to the server actions versus the thread page — only the timing and the surrounding traffic distinguish them. If that attribution ever matters, the fix is separate Arcjet **sites**, not separate clients.

- [x] Decide the approach (report + per-feature recommend/rule-out)
- [x] Build it: `sensitiveInfo` (card numbers) on `/api/chat`
- [x] Build it: per-person rate limit on the server actions, gated before the first write
- [x] Build it: IP-keyed read limit on the public thread page, one decision per view
- [x] Build it: shared `MessageScreen` component, `not-found`/`error` refactored onto it
- [x] Verify: checks clean, read limit trips and recovers live, route smoke-checks pass
- [x] Live check passed (2026-08-11): all three confirmed against the real Arcjet site — see the decision timeline below

## Slice 4: Leaderboard

### 9. Leaderboard: global & personal

Two leaderboards from the same votes, one for everyone, one just for the signed-in user. Each row's win rate is the big, bold number, in the accent color, with a small bar next to it, always written as "won 4 of 5," never a bare percentage or a made-up score. Smaller, quieter numbers underneath for average speed and time-to-first-token, each clearly labeled. No cost or "cheapest" stat, every model is free, so that number never means anything here. First place gets a subtle highlight, nobody else does.

**Decided (2026-08-11), not yet built.** The plan:

- **One aggregation, two scopes.** A single server-side function in the leaderboard feature folder computes rows from real votes, taking an optional owner filter: global = all votes, personal = votes on the signed-in user's own threads. Per model: **wins** = voted turns its message won; **total** = voted turns it participated in — the exact definition Feature 7's thread badges already decided, kept consistent app-wide. **Average tok/s and average time-to-first-token** come from _all_ of that model's `SUCCESS` messages (more data than voted turns alone, and every number is a real stored measurement); a model with no measured value for a metric shows nothing there, never a dash or a zero.
- **Query shape:** composed Prisma queries assembled functionally in TS — voted turns with their messages and vote (small data, votes are the scarce thing), plus a `groupBy` on `Message` for the metric averages. No raw SQL needed at this size, and no new API route: the page is a server component that calls the function directly, exactly like the catalog.
- **Ranking:** wins descending — the raw count is the honest headline, matching "won X of Y" — tie-broken by win rate, then model name for stability. Only models with at least one voted turn appear; an empty board says plainly "No votes yet. Pick some winners in the arena."
- **The toggle becomes real:** the page server-fetches both scopes (cheap at this size) and a small client component switches between them — Global default; Personal shows a sign-in prompt when signed out. The dead Global/Personal buttons and all placeholder rows are deleted.
- **Design, per Feature 4's already-decided system:** each row's headline is the win-tally signature element — "Won 4 of 5" as the big Fraunces numeral in rust with the small proportional rust bar beside it (the sketch's bare `71%` stays overruled, as recorded under Feature 7). Beneath it, the quieter labeled mono numbers: avg tok/s, avg time-to-first-token. First place gets one subtle highlight and nobody else does. Model names resolve from the live catalog with the raw id as fallback, same as the thread page. `frontend-design` gets invoked at build time per CLAUDE.md.
- **Verification:** typecheck/lint/format/build, then `curl` the page and check the server-rendered rows against a direct database query computing the same numbers by hand — the counts must match exactly. Browser pass covers the toggle and signed-out Personal state.

**Built (2026-08-11), per the plan above.** `app/leaderboard/leaderboard-data.ts` holds the aggregation: one `computeRows(clerkId | null)` used for both boards — global passes `null`, personal filters turns to the signed-in user's own threads — so the two scopes can't drift apart. It runs two queries in parallel: voted turns with their messages and vote (votes are the scarce data, so this stays small), plus a `groupBy` on `Message` for the metric averages over every `SUCCESS` answer. Tallies are folded from the voted turns in TS (wins = turns this model's message won, total = voted turns it took part in — the same definition the thread badges use). Sort is wins desc, then win rate, then model id for stability. Unlike the sidebar's thread list, a database failure here deliberately throws rather than returning `[]` — an empty board would falsely read as "no votes yet", so it lands on the app's plain error boundary instead.

`components/leaderboard/leaderboard-tabs.tsx` is the one client component: it owns the Global/Personal toggle (`aria-pressed`, real state — the old dead buttons and every placeholder row are gone), and renders each row as the Feature 4 signature element — "Won 2 of 3" as the big Fraunces numeral in rust with a proportional rust bar beside it, the quieter mono averages underneath, rank number and initial avatar on the left. First place alone gets a subtle `bg-primary/5` highlight. Three honest empty states: no votes at all, personal-with-no-votes, and signed-out personal (a sign-in prompt, since a personal board can't exist without an account). A metric that was never measured simply doesn't render — no dash, no zero.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build` all clean. The real check that matters — the server-rendered page was cross-checked against an independent hand-written SQL aggregation over the same database, and every number matched exactly: six models, `2 of 3` / `2 of 4` / `2 of 7` / `2 of 8` / `0 of 1` / `0 of 1` in that order, with the same average time-to-first-token per row (1902ms, 51250ms, 4457ms, 2989ms, 2900ms, 4114ms). Still open: the browser pass for the toggle and the signed-out personal state.

- [x] Decide the approach
- [x] Build it: the aggregation function (global + personal scopes)
- [x] Build it: the real leaderboard page — tally rows, working toggle, empty states
- [x] Verify: checks + server-rendered numbers cross-checked against an independent SQL query (exact match) — browser pass for the toggle still open

## Not doing right now

Kept here so the plan stays honest about what's deliberately left out.

- A "fastest" label on the leaderboard, tagging whichever model already has the best average speed, only for models with enough votes to mean anything. Nice to have, not required.
- Giving each model's own little icon a distinct look instead of plain gray. Nice to have, not required.
- Privacy policy and terms pages.
- Rich link previews when a thread gets shared somewhere.
- Any kind of admin or moderation page.
- A public API for the leaderboard data. Nobody's asked for this.
