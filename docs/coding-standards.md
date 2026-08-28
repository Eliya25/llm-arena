# Coding standards & tooling

Concrete, checkable version of the Rules section in `CLAUDE.md`. If something here and `CLAUDE.md` ever disagree, `CLAUDE.md` wins — fix this doc, don't quietly follow it.

## Tools

| Purpose      | Tool                                               | Command             |
| ------------ | -------------------------------------------------- | ------------------- |
| Lint         | ESLint (`eslint-config-next`, strict TS, no `any`) | `pnpm lint`         |
| Format       | Prettier + `prettier-plugin-tailwindcss`           | `pnpm format`       |
| Format check | Prettier, no writes                                | `pnpm format:check` |
| Type check   | `tsc --noEmit`                                     | `pnpm typecheck`    |
| Pre-commit   | Husky + lint-staged                                | runs automatically  |

`prettier-plugin-tailwindcss` sorts Tailwind classes against `app/globals.css` (Tailwind v4, CSS-first config, no `tailwind.config.*`) — configured via `tailwindStylesheet` in `.prettierrc.json`.

### Pre-commit hook

`.husky/pre-commit` runs, on every commit, in order:

1. `lint-staged` — `eslint --fix` + `prettier --write` on staged JS/TS files, `prettier --write` on staged JSON/CSS/MD.
2. `tsc --noEmit` — the **whole project**, not just staged files. Deliberate: a commit that only touches one file can still break a type elsewhere (a changed export, a removed field), and CLAUDE.md's "actually run it" rule means that has to be caught before it lands, not after.

Either step failing blocks the commit. The hook also defensively adds `C:\Windows\System32` to `PATH` before running anything — lint-staged spawns `eslint.cmd`/`prettier.cmd` through `cmd.exe` on Windows, and some shells (this one included) don't carry System32 on `PATH` by default, which makes that spawn fail outright with `ENOENT` before eslint/prettier ever run. Without this line the hook blocks every commit for the wrong reason instead of actually linting.

Vitest has separate unit and database projects. Unit tests cover pure behavior. Database tests exercise real PostgreSQL constraints, races and lifecycle rules against an isolated `TEST_DATABASE_URL`. Visible flows still use the manual browser pass.

## Naming & structure

- **Folder by feature**, not by layer. A feature's route, components, and helpers live together; there's no project-wide `components/`, `utils/`, or `hooks/` dumping ground.
- **Files**: `kebab-case.ts` / `kebab-case.tsx`, one main export per file where reasonable.
- **Components**: `PascalCase` function name, matching a `kebab-case` filename (`model-picker.tsx` exports `ModelPicker`).
- **Types & interfaces**: `PascalCase`, no `I`-prefix.
- **Functions & variables**: `camelCase`. Booleans read as a question (`isPending`, `hasVoted`), not `flag` or `status` alone.

## Functional style

- Pure functions by default; side effects (network calls, DB writes, PostHog capture) pushed to the edges — route handlers, server actions — not buried in the middle of business logic.
- No shared mutable state. No module-level `let` used as a cache or counter.
- Immutable data: `const` everywhere, `readonly` on object/array types that shouldn't be mutated by the caller.
- `map` / `filter` / `reduce` over mutating loops (`for`, `.push`, `.splice`) when transforming a collection. A plain `for` loop is fine when the goal genuinely is a side effect per item (e.g. writing to a stream), not when it's building up a new array or object.

## TypeScript

- `strict: true` (already on in `tsconfig.json`) stays on — never turn off a strict flag to make an error go away.
- `any` is an ESLint error (`@typescript-eslint/no-explicit-any`), not just discouraged. Use `unknown` and narrow, or a real type. If a third-party type is genuinely missing, write a local `.d.ts`, don't reach for `any`.
- Prefer `type` for data shapes, `interface` only when you need declaration merging or a class implements it — either is fine, don't churn existing code to switch.

## Error handling

- Never surface a raw exception, stack trace, or provider error string to the user. Catch at the boundary (route handler), log the real error server-side, return a plain sentence plus a retry action.
- Only validate at system boundaries — user input, request bodies, external API responses. Don't defensively re-validate values that internal code already guarantees (e.g. a value just returned from Prisma against a known schema).
- `lib/env.ts` is the only place environment variables get read from `process.env` directly; everything else imports the parsed, typed result. A missing var fails fast at startup (via `instrumentation.ts`), never mid-request.

## Styling

- Shared values — spacing, color, repeated class combinations — live in `app/globals.css` or a shared component, never copy-pasted as raw Tailwind classes across files. Three+ files with the same handful of classes is a component, not a coincidence.
- Every screen keeps the accessibility baseline from `CLAUDE.md`: real contrast (checked by eye, not just computed), a visible focus state on every interactive element, full keyboard operability (tab order, Enter/Space activation, no mouse-only affordances).

## Imports

- No path deeper than `@/*` (already aliased in `tsconfig.json`) — no `../../../` chains across features.
- Group: external packages, then `@/*` internal, then relative. ESLint's `eslint-plugin-import` (bundled via `eslint-config-next`) flags unresolved imports; ordering itself isn't enforced by a rule, keep it by convention.

## Before calling anything done

After building or changing anything, run `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, the relevant Vitest projects and `pnpm build`. Fix failures before calling the step done.
