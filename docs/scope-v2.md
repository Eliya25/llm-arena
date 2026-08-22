# Scope V2 — LLM Arena: Production & Resume Hardening

LLM Arena V1 proved the product.

A signed-in user can choose up to three live free-tier models, send one prompt to independent model streams, compare real responses and performance measurements, vote for a winner, continue conversations, revisit persisted threads, share threads publicly by link, and contribute to global and personal leaderboards.

V2 is not another feature-expansion phase.

The goal is to take the existing working application and harden the parts that matter in a real backend system: trust boundaries, consistency, failure handling, observability, automated verification, database performance, delivery, and operational reasoning.

Every V2 feature must answer three questions before implementation:

1. **What real weakness or scaling problem exists today?**
2. **What backend concept does the change exercise?**
3. **How will the result be verified rather than assumed?**

Do not add infrastructure merely to make the stack larger.

Redis, queues, Kafka, Kubernetes, microservices, extra databases, or new vendors only belong in this project if measurements or a concrete requirement justify them.

---

## V1 baseline

V2 starts from a working V1 with:

- Next.js App Router + TypeScript
- PostgreSQL + Prisma
- Clerk authentication
- OpenRouter model access
- Independent SSE stream per selected model
- Up to three parallel model lanes
- Per-lane retry and stall handling
- Thread, turn, message, and vote persistence
- Real TTFT, token, and tokens/sec measurements
- Global and personal leaderboards
- Public thread sharing
- PostHog product and LLM analytics
- Arcjet protection for:

  - model inference
  - server-side writes
  - public thread reads
  - rate limiting
  - bot detection where appropriate
  - prompt injection
  - sensitive card-number detection
  - Shield

- Coding standards, linting, formatting, type checking, and pre-commit checks
- V1 browser/manual verification completed

The existing product behavior should remain intact while V2 hardens the implementation underneath it.

---

# At a glance

| #   | Feature                                       | Phase               | Priority | Status      |
| --- | --------------------------------------------- | ------------------- | -------- | ----------- |
| 1   | Server-authoritative generation & metrics     | Trust & Correctness | P0       | complete    |
| 2   | Idempotent persistence & lifecycle invariants | Trust & Correctness | P0       | not started |
| 3   | Reliability & failure policy                  | Reliability         | P0       | not started |
| 4   | Production observability & traceability       | Operations          | P1       | not started |
| 5   | Automated test suite                          | Verification        | P1       | not started |
| 6   | Sharing lifecycle & data ownership            | Security / Product  | P1       | not started |
| 7   | Database & leaderboard scalability            | Performance         | P1       | not started |
| 8   | Load, concurrency & capacity verification     | Performance         | P1       | not started |
| 9   | CI/CD, migrations & deployment safety         | Delivery            | P1       | not started |
| 10  | Architecture documentation & production story | Resume / Operations | P2       | not started |

---

# Phase 1 — Trust & Correctness

## 1. Server-authoritative generation and metrics

### Problem

Today the browser receives the model stream and later reports the final response and performance metrics back to the server.

That makes the client part of the trusted data path.

A signed-in user who bypasses the UI can potentially submit fabricated:

- response content
- time to first token
- tokens per second
- token totals

Those values eventually influence persisted threads and the public leaderboard.

Rate limiting reduces abuse volume but does not make client-supplied data trustworthy.

### Goal

The backend becomes the source of truth for every model result.

The browser may display data, but it must not be authoritative for:

- model output
- completion status
- TTFT
- token usage
- generation duration
- tokens per second

### Target flow

```text
Browser
   |
   | start model lane
   v
Backend
   |
   | validate user + message + model
   |
   v
OpenRouter
   |
   | SSE
   v
Backend
   |\
   | \
   |  \--> measure + persist authoritative result
   |
   +-----> stream response to browser
```

The server should own both branches of the operation.

### Decisions to make before coding

- How the request identifies the persisted `Message` row.
- How the server verifies that the message belongs to:

  - the authenticated user
  - the correct turn
  - the requested model

- Whether persistence happens incrementally or only at completion.
- Exact definition of TTFT.
- Exact definition of generation duration.
- Exact formula for tokens/sec.
- What happens if the client disconnects while OpenRouter is still streaming.
- Whether abandoned generations continue or are cancelled.
- How FAILED vs SUCCESS is determined.

### Invariants

A browser must never be able to choose the final metrics written to the database.

A successful database row must correspond to an actual successful upstream generation.

A failed generation must never be persisted as a successful answer.

A successful generation must not become FAILED merely because the UI navigated away.

### Where this actually stands (read before building — 2026-08-13)

The premise above is out of date in one important way, and the plan is written against the real code, not the premise.

V1's Feature 12 already closed the headline hole. `completeMessage` / `failMessage` are gone from `app/arena/actions.ts` (a comment there records why). `app/api/chat/route.ts` `tee()`s the upstream SSE stream, parses one branch server-side in `recordAnswer`, and writes content, status, `timeToFirstTokenMs`, `tokensPerSecond`, and `totalTokens` itself. The browser cannot post an answer or a metric anywhere. `app/leaderboard/leaderboard-data.ts` averages only those stored columns, so the leaderboard is already fed by server-measured numbers.

So Feature 1 is not "move the write to the server". It is: **the server write that exists is not yet trustworthy, complete, or precisely defined.** Six real gaps, each verifiable in the current code:

1. **The row lookup is a timing hack.** `createTurn` runs _in parallel_ with the streams, so the route can't be sure the `Message` row exists yet. `findAnswerRow` polls up to six times at 400ms (`route.ts:56-81`), matching on `clientKey` + `model` with `findFirst` and no unique constraint behind it. A slow `createTurn` past 2.4s silently drops a finished answer on the floor — it logs "No message row for finished answer" and the row is never written.
2. **There is no terminal state for a stream that dies.** `recordAnswer` only writes when `streamComplete` is true; a truncated read leaves the row `PENDING` forever. Honest for a moment, dishonest as a permanent record — V1's own live check already found `PENDING` rows sitting in the database. Nothing ever sweeps them, and the schema has no `STREAMING` state to distinguish "in flight" from "abandoned".
3. **Nothing is persisted until the very end.** A three-minute answer that fails at the 99% mark stores an empty string. The server saw every token and kept none.
4. **The metric definitions are loose, and the leaderboard averages them.** `startedAt` is captured _before_ the `fetch` to OpenRouter (`route.ts:349`), so persisted TTFT silently includes connection and queueing time to the provider, not just the model's own latency. `tokensPerSecond` uses a different window (first token → end). `totalTokens` stores _completion_ tokens only, despite its name; prompt tokens are read and thrown away. There is no stored generation duration at all. These are the numbers a public leaderboard ranks on, so their definitions have to be written down and made consistent.
5. **The background write is fire-and-forget on a serverless platform.** `void recordAnswer(...)` (`route.ts:430`) is unawaited work outside the returned response. The comment claims closing the tab still saves the answer — true on a long-lived Node server, not guaranteed once the response stream closes on a serverless host, where the invocation can be frozen or reclaimed. The invariant "a successful generation must not become FAILED merely because the UI navigated away" currently rests on a runtime assumption nobody has verified.
6. **Conversation history is still client-authored.** The client sends the whole `messages[]` array, including assistant turns it _claims_ prior models produced (`route.ts:29`). Nothing persisted comes from it, so the blast radius is the user's own thread — but it is the last client-supplied input on the model path, and it is the reason the route needs a 40-message / 32k-char validation wall.

### Plan

**A. The server owns the row before it owns the stream.** Kill the polling loop. The route resolves (or creates) its own `Message` row _before_ calling OpenRouter, so by the time a token arrives there is provably a row to write to. Backed by a real `@@unique([turnId, model])` on `Message` and the existing `@unique` on `Turn.clientKey`, so three lanes racing on a first send converge on one turn instead of hoping `createTurn` won. **Decided (2026-08-13): the route owns the row.** `/api/chat` upserts the `Turn` by `clientKey` and its own `Message` by `(turnId, model)` before calling OpenRouter; `createTurn` shrinks to thread creation and the client no longer has to win a race for the answer to be saved. Each lane becomes self-sufficient — it can create everything it needs and write everything it measures. The two rejected alternatives, recorded so this isn't relitigated: making the client _await_ `createTurn` first is simpler but puts a server-action round trip in front of every first token, undoing a deliberate V1 decision; hardening the existing poll keeps the race and keeps the design hard to defend, which is the opposite of what V2 is for.

**B. A real lifecycle, with a terminal state for abandonment.** Add `STREAMING` to `MessageStatus`; the route sets it when the first byte arrives. A stream that dies mid-read becomes a definite outcome, not a permanent `PENDING`. Full transition rules are Feature 2's job — Feature 1 only guarantees every row eventually leaves `PENDING`.

**C. Checkpoint the text.** Persist accumulated content periodically during the stream (time-based, not per-token), so a truncated generation keeps what the model actually said and can be honestly marked as cut short rather than stored empty. Status is still only promoted to `SUCCESS` on a clean upstream finish.

**D. Pin the metric definitions, in the schema and in a comment that outlives this conversation.**

- `timeToFirstTokenMs` — measured from _after_ upstream response headers, to the first non-empty content delta. The model's latency, not the network's.
- `generationDurationMs` (new column) — first token → last token.
- `tokensPerSecond` — completion tokens ÷ generation duration, in seconds.
- `totalTokens` renamed in meaning to be explicit: store `outputTokens` and `inputTokens` separately rather than one ambiguous number.
- Any metric the upstream never reported stays `null`. Never estimated, never zero-filled.

**E. Cancellation and disconnect, decided rather than inherited.** A browser disconnect must not cancel the upstream generation or the write — the answer is already paid for and belongs in the thread. The background write gets registered with the platform's `waitUntil` (via `after()`) instead of a bare `void`, and the behaviour is verified by actually killing a client mid-stream and reading the row back. A stall with no upstream progress is a _server-side_ watchdog, not only the client's 60s `AbortController`.

**F. The browser displays server truth, and says so.** The client keeps its live estimates for responsiveness, but the route ends every stream with a final authoritative SSE frame carrying the persisted row's status and metrics, and the lane snaps to those numbers. Today the in-session numbers are the client's own and the post-reload numbers are the server's, and nothing reconciles them — a visible-to-the-user inconsistency, and the cheapest possible proof that the browser is now a display surface.

**G. History moves server-side (last, and only if D–F land cleanly).** Rebuild each lane's conversation from persisted `SUCCESS` messages for that model, keyed by `turnId`, so the request body carries a prompt and a target rather than an entire fabricated transcript. Deferred rather than dropped: it adds a query in front of TTFT and its trust value is the smallest of the six.

### Built (2026-08-13)

The route is now the only writer of an answer _and_ the owner of the rows it writes into. `app/api/chat/route.ts` kept the request pipeline; the two new pieces beside it are `answer-row.ts` (which rows, and whose) and `record-answer.ts` (what the model said, and what it measured).

**The row exists before the model is called.** `claimAnswerRow` resolves user → thread → turn → message and returns the three ids, ahead of the upstream `fetch`. Convergence is the database's job, not timing's: `Thread.clientKey` and `Turn.clientKey` are unique, `Message` gained `@@unique([turnId, model])`, and one `findOrCreate` helper handles the lost race the only way that is actually correct — catch `P2002`, re-read _scoped to the caller_, and adopt what the winner made. The scoping is what stops a borrowed key from reaching someone else's thread: an intruder's create hits the unique index, the re-read finds nothing of theirs, and the request gets a plain sentence. `findAnswerRow`'s six-attempt, 400ms poll is gone, and so is `createTurn` — with it goes the entire class of "the answer finished before the row existed".

**The ids travel back on the response** (`X-Arena-Thread-Id` / `-Turn-Id` / `-Message-Id`), including on a 429 or 502, so a lane the model refused still knows the turn it belongs to and can be retried. This is what replaced the client's `persistenceRef` and its `CreateTurnResult` promise-per-turn, and with them the `saveFailed` turn state: a turn with no row simply has no stream, and says so per lane.

**A retry rewrites, it doesn't accumulate.** An existing row is reset to empty/`PENDING` with every metric nulled before the new attempt streams into it, so a half-written previous attempt can never sit beside the new one, and a model can't end up with two answers to one turn.

**Lifecycle.** `STREAMING` is a real status now, written by the first checkpoint. Content is checkpointed every 2s, so a generation that dies at the 99% mark keeps what the model actually said instead of storing an empty string. Terminal rules, deliberately narrow: only a _clean_ upstream finish **with content** is `SUCCESS`. A truncated read is `FAILED` with its partial text kept. A clean finish with zero content is also `FAILED` — that case is real (V1's live check found a row with 79 tokens of usage and not one visible character), and calling it a success would put an empty card in the arena that can be voted for and feed the leaderboard a win nobody could read.

**Metric definitions are pinned in the schema** next to the columns, so they outlive this conversation. TTFT is measured from upstream response headers, not from before the `fetch` — the old number silently included the trip to OpenRouter. `generationDurationMs` is new; `totalTokens` was _renamed_ to `outputTokens` in the migration rather than dropped and re-added, because every existing value in it was already a completion-token count; `inputTokens` is now kept instead of read and discarded.

**Disconnect and stall.** The recording branch is handed to `after()` rather than left as a bare `void`, so the platform keeps it alive after the response ends — "closing the tab still saves the answer" stopped being an assumption about the runtime. The stall watchdog now exists server-side too (120s for a first token, 60s between tokens, matching the client's budgets), aborting the upstream fetch, which lands as a `FAILED` row with partial content rather than a row waiting forever.

**The browser reads the server's numbers back.** Every stream closes with an `{"arena": …}` SSE frame carrying exactly what was stored, and the lane snaps to it: live estimates during streaming, server values at rest. Two consequences worth naming. The in-session numbers and the post-reload numbers are now the same numbers. And a lane can no longer read "finished" before its row is written, which is what the vote rules are checked against — the client's vote-retry loop survives only as a narrow net for the case where the closing frame times out.

**One fix that wasn't in the plan.** The prompt box is deliberately never disabled, so a second prompt sent before the first response came back used to carry a second thread key and open a second thread for one conversation. The key is now held in a ref across sends until the thread has a real id.

**G (server-rebuilt history) was not built** — deferred as planned. The client still sends the transcript, which remains the last client-authored input on the model path. Nothing persisted comes from it.

### Verification

Checks clean: `tsc --noEmit`, `eslint .`, `prettier --check`, `next build`. Migration applied to the real database (checked first for duplicate `(turnId, model)` rows — none), `prisma migrate status` in sync.

Beyond that, the parts that don't need a browser were exercised against the real database with a throwaway script driving the real functions (no test runner installed — see CLAUDE.md), then deleted:

- **Three lanes racing on a brand-new thread → one thread, one turn, three distinct message rows**, all three returning identical thread/turn ids. The convergence works.
- **Retry reuses the same row and clears it**: a row seeded with stale content, `SUCCESS`, and 99 output tokens came back empty/`PENDING`/null, and the turn still had exactly three rows.
- **Ownership holds against borrowed identifiers**: a different `clerkId` presenting the same `clientKey`/`threadKey` did _not_ reach that turn, and presenting the `turnId` directly returned nothing.
- **Metrics are right, not just present**: a synthetic stream with a 500ms first-token delay and a 1s body stored `timeToFirstTokenMs: 511`, `generationDurationMs: 1012`, `tokensPerSecond: 39.53` (40 tokens ÷ 1.012s), plus both token counts.
- **Checkpointing observed mid-flight**: sampled between the checkpoint and the end of the stream, the row read `STREAMING` with partial content, then `SUCCESS`.
- **A stream errored partway** stored `FAILED` with its partial text intact; **a clean stream with no content** stored `FAILED`; `onProgress` reported `[false, true, true]`, so the watchdog gets the right first-token signal.

Still to be confirmed in a real browser (Clerk sessions and Arcjet's bot rule put these out of reach of `curl`), listed as steps in the reply rather than repeated here: the end-to-end send, the closing frame reconciling on-screen numbers with the database, mid-stream tab close, and voting.

Left alone knowingly: the two historical `PENDING` rows in the database from V1. They render as "didn't finish", which is what they are.

### Live check (2026-08-13) — passed the important part, found two real defects

A real signed-in session sent prompts and then reloaded the page mid-answer. Every claim below is read back from the rows, not from the screen.

**The thing this feature exists for works.** On the reloaded turn, the lane that was mid-stream when the browser disconnected went on to write **3143 characters and `SUCCESS`, roughly fifty seconds after that page had already loaded**. The lane still waiting on its first token was closed out as `FAILED` by the server's own watchdog, on time. Losing the browser genuinely no longer costs an answer.

On an earlier turn, all three lanes' on-screen numbers were compared against their rows: `8950 / 31.50 / 1052`, `5141 / 517.97 / 1023`, `1089 / 39.32 / 558` — identical to the display, rounding aside. The closing frame does what it claims.

**Defect 1 — a label that lied.** Reloading mid-answer showed "This answer didn't finish" under a generation the server was busy writing. `STREAMING` and `PENDING` were being rendered as one thing. They are now three different sentences (`STREAMING` → "Still being written — reload in a moment.", `PENDING` → "didn't finish", `FAILED` → "stopped partway" or "didn't answer"), and a partly-written answer now shows the text it has instead of hiding it behind the label.

**Defect 2 — `tokensPerSecond` was nonsense for reasoning models, and the leaderboard ranks on it.** One row stored **829 output tokens against 49 characters of Hebrew** — the model spent its budget on reasoning tokens that were never streamed — and dividing all 829 by the 263ms it took to deliver the visible part produced **3152 tok/s**. Decided and changed: the rate is now `outputTokens ÷ (response headers → last delta)`, the whole window rather than the streaming part, because reasoning tokens are produced precisely during the wait for the first visible token. On the real rows that turns 3152 into 135 and leaves a steadily-streaming model near where it was (50.0 → 49.7). `generationDurationMs` still stores first→last, unchanged — it is a useful number, just the wrong denominator. The rejected alternative was subtracting `reasoning_tokens` from the count, which depends on a `completion_tokens_details` field free-tier providers do not reliably send.

**One fix tried and reverted, recorded so it isn't retried.** The `PENDING` row was briefly mistaken for one stranded forever, and an abort listener was added to close out a row the moment the browser disconnected. Re-reading the row showed the watchdog had already handled it correctly — the sample was simply taken inside the 120s window. The listener was removed: it would have published "this model didn't answer" over generations that were still on their way. What stayed is a 15-minute sweep at claim time, which covers the case the watchdogs genuinely cannot — the process dying and taking every in-flight timer with it.

**Review fix (2026-08-21).** The stall watchdog was being told about a chunk before that chunk was parsed, so the one carrying the first token still reported "no token yet" and left the watchdog on the 120s initial-response budget instead of switching to the 60s between-token one. It only mattered when a stream died immediately after its first token — precisely the case the shorter budget exists for. Progress is now reported after parsing; a probe of that exact shape reports `[false, true]` where it used to report `[false, false]`.

**Review fix (2026-08-21) — stale writers, and a piece of Feature 2 landing early.** A retry reuses the `(turnId, model)` row, and the previous attempt's recorder can still be reading: `after()` keeps it alive on purpose, and the client marks a lane failed on its own budget, not the server's. So the old recorder went on checkpointing and then wrote its terminal result straight over the answer that replaced it — content, status and token counts. Reproduced against the real database before fixing: the row ended up holding the old attempt's text and 999 tokens.

`Message` gains an `attempt` counter. Claiming a row is now always an atomic increment — including on a row the request just created, since two requests racing into creating it would otherwise both believe they owned attempt 0 — in the same statement that blanks the row, so there is no moment where an attempt is claimed but unprotected. Every recorder write is conditioned on the attempt it owns via `updateMany`; a write that matches zero rows means a retry has taken over, so the recorder stops reading, writes nothing, and returns null, which makes the route omit its closing frame rather than describe a row it did not write. The same condition guards `markAnswerFailed`, so a stale failure can't land on a live answer either.

Two refinements from a second review pass. The ownership check now runs on every checkpoint interval whether or not visible text has arrived — it was gated behind having content to save, so a superseded reasoning-heavy generation, which by definition has produced nothing visible yet, went unnoticed until its upstream finished on its own and held a model connection open the whole time. With no text to write it asks as a read rather than a write, so `STREAMING` keeps meaning "tokens have arrived", and on supersession it now cancels the branch instead of merely stopping the loop. Measured: a stream that would have read 30 frames over 14 seconds stops after 8 frames and 1.7 seconds. A third pass closed the remaining gap — the check still only ran when a chunk arrived, so a retry landing inside a genuinely silent interval went unnoticed until the next chunk or the watchdog. The loop now waits on the checkpoint interval and the outstanding read together, holding the pending read across ticks so a checkpoint never consumes the chunk being delivered; a supersession during 30 seconds of complete silence is now caught in 4.8. That change bit back immediately and is worth remembering: charging a chunk the time it was _processed_ rather than the time it _arrived_ let a checkpoint write land inside the measurement, and a stream whose real span was 2500ms recorded 4804ms. Chunks now stamp themselves the instant their read resolves. The recorder also no longer tracks supersession in a reassigned flag — the read returns `"complete" | "interrupted" | "superseded"` and every later decision is derived from it, which is both the repository's stated style and one fewer piece of state to reason about across async branches.

This is `attempt number` and `stale-result protection` from Feature 2's topic list, pulled forward because it is a correctness bug in what Feature 1 shipped, not an enhancement. What is left for Feature 2 is the part this doesn't cover: enforcing which status transitions are legal at all.

**Closed out (2026-08-21).** The remaining browser checks passed. Two prompts in two separate threads, each with all three lanes `SUCCESS` and exactly one vote — and in both, the winner was picked while a third lane was still streaming, which then finished normally. That is V1's "vote before persistence completes" race, and it no longer exists: a lane only reads finished after its row is written.

The historical metrics were corrected, as a migration rather than a one-off command so the fix is reviewable and reproducible (`20260821110000_recompute_tokens_per_second`). Five rows were recomputed exactly from their stored terms; the 44 pre-migration rows, whose measurement window is simply gone, had `tokensPerSecond` cleared. Clearing rather than keeping, because the leaderboard averages the column and cannot tell the definitions apart — an absent measurement is not counted, while a number from the old definition quietly bends the result. Wins and losses were untouched. The table now holds 11 speed figures, all under one definition, spanning 12.5 to 143.8 tok/s, and **not one row is left in PENDING or STREAMING** — every generation in the database has reached a terminal state.

### Verification (original checklist)

- Attempt to fabricate metrics from the browser.

- Attempt to submit fabricated model content.

- Disconnect the browser during a live generation.

- Fail OpenRouter mid-stream.

- Complete three lanes concurrently.

- Verify database values against the actual upstream stream.

- Verify leaderboard metrics use only server-authoritative values.

- [x] Audit what V1 Feature 12 already closed, and what it didn't

- [x] Decide row ownership — the route owns it

- [x] A — resolve/create the message row before the upstream call; delete the polling loop

- [x] A — `@@unique([turnId, model])` migration

- [x] B — add `STREAMING`; no row can end its life `PENDING`

- [x] C — checkpoint streamed content

- [x] D — pin TTFT / duration / tok-s / token definitions, schema + comment

- [x] E — `after()` for the background write; server-side stall watchdog

- [x] F — authoritative terminal SSE frame; client snaps to server metrics

- [ ] G — server-rebuilt history (deferred; only after D–F)

- [x] Verify without a browser: concurrent lanes, retry reuse, borrowed identifiers, metric values, checkpointing, truncated and empty streams

- [x] Live browser check: end-to-end send, closing frame vs database, mid-stream reload, immediate voting

- [x] Document the new trust boundary (this section, plus the comments at each boundary in the code)

---

## 2. Idempotent persistence and lifecycle invariants

### Problem

Streaming systems are naturally retry-prone.

A user can:

- retry a failed lane
- double-click
- refresh
- lose connectivity
- resend after a timeout
- trigger two nearly simultaneous operations

Without explicit lifecycle rules, duplicate or stale operations can overwrite newer state or create dishonest records.

### Goal

Make each model-generation lifecycle predictable under retries and concurrency.

### Model lifecycle

Define and enforce a state transition model similar to:

```text
PENDING
   |
   v
STREAMING
  /   \
 v     v
SUCCESS FAILED
```

Transitions should be deliberate rather than arbitrary updates.

Examples:

```text
SUCCESS -> PENDING    forbidden
FAILED  -> SUCCESS    only through a new attempt
SUCCESS -> FAILED     forbidden
```

A retry should be distinguishable from the original attempt.

### Topics to evaluate

- attempt number
- idempotency key
- optimistic concurrency
- conditional updates
- unique constraints
- stale-result protection
- duplicate request handling

Do not introduce all of them automatically. Use only the mechanisms required by the final lifecycle design.

### Verification

Create regression cases for:

- two simultaneous completion attempts
- retry while an older attempt is still completing
- duplicate vote submission
- stale response arriving after a retry
- browser refresh during streaming
- repeated server-action invocation

The final persisted state must always represent the winning/latest valid operation.

- [ ] Define generation state machine
- [ ] Define retry semantics
- [ ] Prevent stale writes
- [ ] Prevent duplicate logical operations
- [ ] Add persistence invariant tests
- [ ] Document concurrency decisions

---

# Phase 2 — Reliability

## 3. Reliability and failure policy

### Problem

The application already handles individual model failures and prevents one lane from blocking the others.

V2 should turn those individual behaviors into an explicit reliability policy.

### Goal

Every dependency failure should have a deliberate answer.

Dependencies include:

- OpenRouter
- PostgreSQL
- Arcjet
- Clerk
- PostHog
- OpenRouter model catalog

### Error classification

Separate errors into categories such as:

```text
Client error
Authentication / authorization error
Rate limit
Validation error
Upstream timeout
Upstream 429
Upstream 5xx
Database failure
Analytics failure
Security denial
Internal programming error
```

Do not treat every failure as retryable.

### Retry policy

Define where retrying is safe.

Possible rules:

- validation errors → never retry
- authentication errors → never retry
- model-not-allowed → never retry
- upstream transient 5xx → limited retry
- upstream 429 → respect provider behavior / Retry-After where available
- network interruption → retry only when operation semantics allow it
- database writes → retry only when idempotency makes it safe

If automatic retries are introduced, use bounded retry counts and backoff rather than infinite retry loops.

### Partial failure remains a first-class behavior

```text
Model A -> SUCCESS
Model B -> FAILED
Model C -> SUCCESS
```

should still be a valid Arena turn.

The application must never require all three providers to succeed before the user can continue.

### Dependency isolation

PostHog failure must not destroy an otherwise valid generation.

Non-critical analytics should remain non-critical.

Security failures must retain their intentionally chosen fail-open/fail-closed semantics.

### Verification

- simulate upstream 429

- simulate upstream 500

- simulate network timeout

- simulate DB failure

- simulate PostHog failure

- simulate Arcjet failure

- verify one failed model does not stop healthy lanes

- verify retry counts remain bounded

- [ ] Define error taxonomy

- [ ] Define retryable vs non-retryable errors

- [ ] Implement bounded retry policy where justified

- [ ] Isolate non-critical dependencies

- [ ] Verify partial failures

- [ ] Document failure semantics

---

# Phase 3 — Operations

## 4. Production observability and traceability

### Problem

Product analytics exist, but debugging a production backend requires following one operation across components.

When a user reports:

> "Gemini stopped halfway through my Arena turn"

the system should provide enough evidence to reconstruct what happened.

### Goal

Make each Arena operation traceable without logging sensitive user data carelessly.

### Correlation

Every relevant operation should be connectable through identifiers such as:

- request ID
- user ID where appropriate
- thread ID
- turn ID
- message ID
- model ID
- attempt number

One logical model generation should be traceable from:

```text
incoming request
   ->
security decision
   ->
OpenRouter request
   ->
first token
   ->
stream completion/failure
   ->
database persistence
```

### Structured logging

Prefer structured events over unstructured strings.

Example logical shape:

```text
event = "model_generation_completed"
turnId
messageId
model
attempt
durationMs
ttftMs
totalTokens
status
```

Never log secrets.

Avoid logging raw prompts or model responses by default.

### Operational metrics

At minimum make it possible to inspect:

- request volume
- model success rate
- model failure rate
- rate-limit denials
- upstream 429 rate
- upstream 5xx rate
- TTFT p50 / p95 / p99
- total generation latency
- retries per model
- DB query/write latency
- incomplete generations

Choose the actual telemetry implementation only after deciding what information is needed.

Do not add another observability vendor simply to add a logo to the stack.

- [ ] Define correlation identifiers
- [ ] Add structured operational logs
- [ ] Add generation lifecycle events
- [ ] Define key production metrics
- [ ] Ensure sensitive data is redacted
- [ ] Verify one failed Arena turn can be reconstructed from telemetry

---

# Phase 4 — Verification

## 5. Automated test suite

### Problem

V1 has strong manual and PR-time verification, but important behavior should survive future refactors automatically.

The most valuable tests are the ones protecting bugs that already occurred or invariants that would be expensive to rediscover.

### The rule this feature had to resolve first (2026-08-21)

`CLAUDE.md` carried a standing rule — "no test runner, no browser automation framework... that's already decided, not something to add later" — which contradicted this feature outright. Recorded rather than quietly worked around, and settled by the owner: the rule was written for V1, where features were screens a person could look at. V2 is concurrency, races, and stale writes, which have no visual representation at all.

`CLAUDE.md` now allows an automated suite **only for what a person cannot see**, and keeps the ban on browser automation exactly as it was. The manual browser pass stays mandatory.

The evidence that settled it came from Feature 1's own review rounds: a change recorded a 2500ms generation as 4804ms — the number the leaderboard ranks models by — and it read as completely innocent in the diff. It was caught by re-running a throwaway script. Ten such scripts were written and deleted across that feature, rebuilding the same six scenarios each time: the retry collision, exact metrics, a truncated read, empty-but-clean, the watchdog signal, and supersession. Those are the first tests to write, because they are the bugs that already happened.

Tooling is still open (see the checklist). Note for whoever picks it: the throwaway scripts ran on `node --experimental-transform-types` with a hand-written loader for the `@/` alias, which works but leans on an experimental flag. That tradeoff — zero dependencies against a runner that handles TypeScript and path aliases natively — is the actual decision to make.

### Testing layers

#### Unit tests

For deterministic logic such as:

- message validation
- leaderboard calculations
- error classification
- state transitions
- history truncation
- metric calculations

#### Integration tests

Exercise boundaries between:

- route + authentication
- route + mocked OpenRouter
- server actions + PostgreSQL
- persistence + voting
- retry + lifecycle state
- model allowlist
- Arcjet decision handling

#### End-to-end tests

Cover critical user flows:

```text
sign in
select models
send prompt
receive parallel answers
vote
reload
continue thread
share thread
view shared thread signed out
start new chat
```

#### Regression tests

Every meaningful concurrency bug fixed during V1/V2 should receive a permanent regression test when practical.

Important examples already encountered:

- vote before persistence completes
- history truncation starting with an orphan assistant message
- New Chat adopting a stale `createTurn`
- abandoned streams being incorrectly marked FAILED
- paid model injection
- anonymous OpenRouter usage

### Plan (2026-08-21)

**The second contradiction, resolved first.** The E2E section above asks for automated browser flows, and `CLAUDE.md` keeps its ban on browser automation — deliberately, and not up for revisiting. So automated E2E is **out of scope for this feature**, and the checklist item is struck rather than silently skipped. The manual browser pass covers those flows and has earned its keep: the owner reloading a page mid-answer is what exposed both of Feature 1's live defects. What replaces automated E2E is a written pass list, so the manual check is repeatable instead of improvised each time.

**What gets written first, and why exactly these.** Not a survey of the codebase — the six scenarios that were rebuilt as throwaway scripts ten times during Feature 1, because each one already caught something:

1. **Retry collision.** Attempt 1 streaming, retry claims the row, attempt 1 finishes last. Caught a real overwrite: the row held the old attempt's text and 999 tokens.
2. **Metric exactness.** A stream with a known shape must record the ttft and duration it actually had. Caught a 2500ms generation recorded as 4804ms.
3. **Truncated read.** Partial text kept, stored `FAILED`.
4. **Clean but empty.** `FAILED`, so an empty card cannot be voted for.
5. **Watchdog signal.** The chunk carrying the first token reports `true`, so the short between-token budget arms. Caught an off-by-one-chunk.
6. **Supersession.** Detected both when no visible text has arrived and during total silence, releasing the upstream.

**Then the trust boundary**, which has never had an automated check at all: a borrowed `clientKey`/`threadKey`/`turnId` must not reach another user's thread; three racing lanes must converge on one thread and one turn; a vote needs two `SUCCESS` answers, an owned turn, and cannot be cast twice.

**Then the pure logic.** Cheap and fast, no database: `measure`, `absorbLine`/`absorb`, `parseChunk`, `isValidMessage`, and the leaderboard tally. Two of these need a small extraction first, and the extraction is worth it on its own:

- `buildHistory` lives inside `arena-client.tsx` and holds a V1 regression rule — history must not open with an orphan assistant message. It moves to its own module.
- The leaderboard's tally is currently welded to its query. The counting rule separates from the fetching.

**Where tests live.** Beside the code, per the folder-by-feature rule: `app/api/chat/record-answer.test.ts`, not a top-level `tests/` tree.

**Deliberately not doing.** No coverage target — the scope already says not to chase a percentage. No mocking of Prisma; the database tests use a real database, because the bugs being protected against are database-behaviour bugs (unique constraints, conditional updates, atomic increments) that a mock would happily fake.

**Decided (2026-08-21).**

**Runner: Vitest**, one dev dependency. It runs TypeScript and resolves the `@/` alias out of `tsconfig` on its own. The alternative was `node --test` with zero dependencies, rejected because getting it there needs `--experimental-transform-types` plus the hand-written module loader the throwaway scripts used — an experimental flag that can move under us on the next Node release, and infrastructure code of our own to maintain. Six of the first tests are about the timing of concurrent streams, which is where a runner earns its keep.

**Database: a separate Prisma Postgres instance**, reached through its own `TEST_DATABASE_URL`. The tests can then be destructive and clean completely, and no bug in a test can reach real threads — the throwaway scripts were writing to the live database with random `clerkId`s and a delete at the end, which worked but only because nothing went wrong. Feature 9 needs this anyway: CI cannot point at the product's database. A local Postgres in Docker was the other candidate, rejected for adding a Docker prerequisite to simply running the checks.

Environment handling follows the existing fail-fast rule: `TEST_DATABASE_URL` is required by the test setup, not by `lib/env.ts`, so the app itself never gains a variable it does not use. Migrations run against it with `prisma migrate deploy` before the suite.

### Built so far (2026-08-22) — the half that needs no database

Vitest is in as a dev dependency, `pnpm test` runs it, and `vitest.config.mts` declares the `@/` alias itself rather than pulling in a plugin to read `tsconfig`. **49 tests pass in under 200ms**, none of them touching a database or requiring an environment variable.

Three extractions made that possible, and each is worth having on its own:

- **`components/arena/build-history.ts`** — was a closure inside a 900-line component, holding a V1 regression rule (history must never open with an orphan assistant message, because the server rejects it and the whole turn fails). Now a pure function with seven tests, including that rule.
- **`app/leaderboard/tally.ts`** — the counting rule was welded to its query. Wins, participation, dedupe, and the three-level ranking are now readable and checked, including that a model with no measurements publishes `null` rather than a zero that would read as the slowest model in the arena.
- **`app/api/chat/stream-reading.ts`** and **`request-shape.ts`** — the SSE fold, the metric definitions, and the request wall, all pulled out of modules that import Prisma and Arcjet. This is why the unit suite needs no environment: the fail-fast env check fired on the first run, which was the rule working exactly as intended and a fair sign the pure logic was sitting in the wrong place.

`app/api/chat/route.ts` lost its inline validation to `readChatRequest`, so `POST` now opens with three lines instead of thirty.

Notable tests, in the sense of "this would have caught something real": the reasoning-model rate (829 tokens over 49 characters must read 135 tok/s, not 3152), a role-only opening frame not counting as a first token, an SSE line split mid-JSON across two chunks, a reported zero staying zero instead of falling back to null, and history trimming that strands an answer whose question was cut off.

**Still to build:** the six integration scenarios and the trust-boundary tests. Both need `TEST_DATABASE_URL`, which is the owner's to create.

### Philosophy

Do not chase percentage coverage.

Protect important behavior.

- [x] Choose test tooling — Vitest, against a separate Prisma Postgres instance
- [x] Add unit-test foundation — Vitest, 49 tests, no database or env needed
- [ ] Add database integration-test setup
- [ ] Cover authorization/trust boundaries
- [ ] Cover streaming lifecycle
- [ ] Cover concurrency regressions
- [x] Manual pass list written (`docs/manual-pass.md`), replacing automated E2E — **dropped**, conflicts with the retained browser-automation ban; replaced by a written manual pass list
- [ ] Run the suite in CI

---

# Phase 5 — Security and Data Lifecycle

## 6. Sharing lifecycle and data ownership

### Problem

A shared thread is currently public to anyone who possesses the link.

Production-grade sharing should have an explicit lifecycle rather than permanent exposure by accident.

### Goal

Make ownership and visibility deliberate.

### Evaluate

- private vs shared state
- explicit Share action
- Unshare / revoke access
- thread deletion
- behavior of previously copied links after unsharing
- ownership enforcement for all mutations
- whether a share token should be distinct from the database thread ID
- whether shared content should be indexable by search engines
- what data is safe to expose in page metadata

Do not turn this into a full permissions platform.

The goal is a clear and defensible sharing model.

### Remaining public-read protection

Review `/leaderboard` as another anonymous database-backed surface.

If measurements show the query is expensive enough to abuse, give it an appropriate read protection strategy rather than copying another rate limit blindly.

- [ ] Define thread visibility lifecycle
- [ ] Implement revoke/unshare behavior if selected
- [ ] Verify unauthorized mutation attempts
- [ ] Review public metadata exposure
- [ ] Review leaderboard abuse surface
- [ ] Document public-data guarantees

---

# Phase 6 — Database and Scale

## 7. Database and leaderboard scalability

### Problem

The current leaderboard is correct, but part of its aggregation is performed in application memory after loading voted turns.

That is reasonable for V1 traffic.

V2 should determine how the design behaves as data grows.

### Rule

**Measure before optimizing.**

Do not add Redis or a precomputed statistics table before proving the current query needs help.

### Baseline

Measure representative datasets such as:

- 1,000 turns
- 10,000 turns
- 100,000 turns
- larger only if useful

Inspect:

- query duration
- rows read
- memory used by application aggregation
- database execution plan
- index usage

Use PostgreSQL query analysis rather than guessing.

### Possible optimization ladder

Only move down the ladder as evidence requires it:

```text
Current query
   |
   v
Better indexes
   |
   v
SQL-side aggregation
   |
   v
Cached aggregate
   |
   v
Precomputed statistics / background aggregation
```

Stopping at any level is valid if performance is already acceptable.

### Additional DB review

Inspect query patterns for:

- thread list
- thread loading
- turn/message loading
- voting
- leaderboard
- model metrics

Add indexes only when they correspond to real access patterns.

### Pagination

Review whether long thread lists or large conversation histories should remain unbounded.

- [ ] Establish performance baseline
- [ ] Run EXPLAIN / query analysis
- [ ] Review indexes against access patterns
- [ ] Move aggregation toward SQL if justified
- [ ] Add caching only if justified
- [ ] Review pagination requirements
- [ ] Record before/after measurements

---

## 8. Load, concurrency and capacity verification

### Goal

Know where the current architecture breaks before calling it production-ready.

### Scenarios

Test:

- many users reading shared threads
- many authenticated users creating Arena turns
- three simultaneous model lanes per turn
- users immediately sending follow-ups
- repeated retries
- slow streaming responses
- multiple concurrent votes
- database pressure
- rate-limit behavior under bursts

### Measure

- requests/sec
- concurrent streams
- server memory
- response latency
- TTFT
- database latency
- error rate
- upstream failures
- rate-limit denial rate

### Backpressure

Explicitly inspect what happens when the system receives work faster than dependencies can process it.

Do not add a queue automatically.

First decide whether the current synchronous request/stream model actually requires one.

### Outcome

The result should be a documented capacity baseline such as:

```text
Under environment X,
the current deployment supports Y concurrent Arena turns
before p95 latency or error rate crosses the chosen limit.
```

Exact numbers must come from measurement, not estimates.

- [ ] Define representative load scenarios
- [ ] Establish baseline
- [ ] Test concurrent streaming
- [ ] Test burst behavior
- [ ] Inspect resource usage
- [ ] Identify first bottleneck
- [ ] Optimize only the measured bottleneck
- [ ] Record capacity findings

---

# Phase 7 — Delivery

## 9. CI/CD, migrations and deployment safety

### Goal

A change should not reach production merely because it works on one developer machine.

### Pull-request pipeline

Automatically run:

- formatting check
- lint
- TypeScript check
- unit tests
- integration tests where practical
- production build

No merge should silently bypass failing required checks.

### Database migrations

Define:

- how migrations are generated
- how migrations are reviewed
- when migrations run
- what happens when application code and schema versions differ
- how destructive migrations are handled
- rollback/recovery strategy

Do not run uncontrolled schema changes from application startup.

### Environment separation

Keep explicit separation between:

- local development
- test
- preview/staging if used
- production

Secrets must never enter the repository.

### Deployment verification

After deployment, verify a small health/smoke path rather than assuming a successful build means a healthy application.

### Recovery

Document how to respond when:

- deployment is broken

- migration fails

- OpenRouter credentials fail

- Arcjet key/config is wrong

- database becomes unavailable

- [ ] Add CI workflow

- [ ] Require critical checks

- [ ] Add automated tests to CI

- [ ] Define migration workflow

- [ ] Define environment boundaries

- [ ] Add post-deploy smoke verification

- [ ] Document rollback/recovery path

---

# Phase 8 — Architecture and Resume Story

## 10. Architecture documentation and production story

The finished project should be understandable without reading every source file.

### README

The repository README should clearly explain:

- what LLM Arena does
- architecture
- stack
- how one prompt fans out
- why streams are independent
- authentication and trust boundaries
- persistence model
- security/abuse strategy
- observability
- how to run locally
- how to test
- production deployment
- important tradeoffs

### Architecture diagram

Document the final request path.

Example:

```text
                    User
                      |
                      v
                Next.js App
                      |
                 Clerk Auth
                      |
                   Arcjet
                      |
              Arena Backend
                /    |    \
               /     |     \
              v      v      v
         Model A  Model B  Model C
              \      |      /
               \     |     /
                v    v    v
              Persistence
                  |
              PostgreSQL
                  |
             Leaderboards

       Telemetry / Analytics
              |
           PostHog +
       operational logging
```

The final diagram should reflect the real implementation, not an aspirational architecture.

### ADRs

Write short Architecture Decision Records for decisions worth discussing in interviews.

Good candidates:

1. Why each model uses an independent stream.
2. Why model IDs are validated server-side.
3. Why server-authoritative generation replaced client-authoritative persistence.
4. Why Arcjet uses separate policies/buckets for different surfaces.
5. How retries and generation lifecycle are kept idempotent.
6. Why leaderboard scaling stopped at the optimization level actually needed.

### Interview value

By the end of V2, the project should support serious discussion of:

- API design

- streaming

- concurrency

- race conditions

- partial failure

- retries

- idempotency

- authentication

- authorization

- trust boundaries

- rate limiting

- abuse prevention

- SQL/query optimization

- observability

- testing

- CI/CD

- production tradeoffs

- LLM integration

- [ ] Rewrite README around the completed architecture

- [ ] Add architecture diagram

- [ ] Add selected ADRs

- [ ] Add setup/testing/deployment documentation

- [ ] Verify documentation matches reality

- [ ] Prepare concise project explanation for interviews

---

# Explicit non-goals

The following are **not** V2 requirements unless a real problem justifies them:

- Microservices
- Kubernetes
- Kafka
- RabbitMQ
- Redis
- separate backend service solely for architectural appearance
- GraphQL
- vector database
- RAG
- AI agents
- MCP
- arbitrary paid-model support
- multi-cloud deployment
- complex event-driven architecture

Those are useful technologies in the right system.

They do not make this project better merely by existing in its dependency list.

RAG, Agents, MCP, queues, and other AI/backend patterns are better candidates for separate projects when their presence is fundamental to the product rather than decorative.

---

# V2 completion criteria

LLM Arena V2 is complete when:

1. The backend, not the browser, owns persisted model output and metrics.
2. Streaming retries and duplicate operations cannot corrupt persisted state.
3. Failure and retry behavior is explicitly defined and verified.
4. A production incident can be traced through structured telemetry.
5. Critical behavior is protected by automated tests.
6. Public sharing has a deliberate data lifecycle.
7. Database performance has been measured and optimized only where necessary.
8. Concurrency/load behavior has a documented baseline.
9. Pull requests and deployments pass automated quality gates.
10. The repository clearly explains the final architecture and its tradeoffs.

At that point, stop expanding LLM Arena merely to keep working on it.

The goal is not to turn one portfolio project into every backend system imaginable.

The goal is to finish one focused AI + Backend system deeply enough that every important architectural decision can be defended.
