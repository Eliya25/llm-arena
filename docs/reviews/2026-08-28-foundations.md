# Review, branch, 2026-08-28

**Reviewed by**: GPT-5 Codex (author on unspecified model)
**Scope**: 9 files, focused re-review on branch vs `origin/main`
**Verdict**: Approve

## Summary

This re-review covered the fixes for the earlier load-testing and operational-route findings. Both prior majors are resolved: `/api/chat` now resolves relative controlled-upstream URLs against the current request origin, and the capacity harness now models one real turn as three simultaneous model lanes that share the same turn and thread keys. The earlier test-coverage gap is also resolved with focused route and helper tests, and I did not find a new regression in the reviewed files.

## Strengths

- `resolveUpstreamUrl()` is a small, targeted fix that preserves the production absolute upstream while making the documented preview-only relative upstream configuration work.
- The revised capacity harness now measures prompt-level concurrency instead of isolated single streams, which better matches the product's real three-lane fanout and row-claim path.
- The new route tests cover the important operational guards: hidden-on-missing-secret behavior, disabled load mode, authorized access, and health-check failure handling without leaking details.

## Test coverage

The previously missing operational coverage is now present in [app/api/health/route.test.ts](C:/Users/User/Desktop/eliya-projects/llm-arena/app/api/health/route.test.ts) and [app/api/load/mock-openrouter/route.test.ts](C:/Users/User/Desktop/eliya-projects/llm-arena/app/api/load/mock-openrouter/route.test.ts), and the URL-resolution helper is covered in [lib/upstream-url.test.ts](C:/Users/User/Desktop/eliya-projects/llm-arena/lib/upstream-url.test.ts). I also ran `pnpm vitest run app/api/health/route.test.ts app/api/load/mock-openrouter/route.test.ts lib/upstream-url.test.ts`, and all 3 files / 8 tests passed.
