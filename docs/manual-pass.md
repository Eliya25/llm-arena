# Manual pass

The flows a person has to look at. This list exists because `AGENTS.md` keeps
the ban on browser automation — a screen is verified by looking at it — and
"look at it" only stays honest if it means the same thing every time.

Run it against a dev server before calling a feature done. It takes about five
minutes. Automated tests cover what nobody can see (`*.test.ts`, run with
`pnpm test`); this covers the rest.

Two of Feature 1's real defects were found here and by nothing else, both by
reloading a page mid-answer. The list is not a formality.

## Before you start

- `pnpm dev`, signed in, at `/arena`.
- Have the database to hand if you want to confirm a row (`docs/scope-v2.md`
  shows the queries used during Feature 1).

## Sending

- [ ] **Three lanes answer.** Send a prompt with three models selected. All
      three stream independently — a slow one does not hold up the others.
- [ ] **A slow model reads as slow, not broken.** A lane with no first token
      yet counts its wait out loud rather than sitting blank.
- [ ] **Numbers are only ever real.** While streaming, estimates carry `~`. The
      moment a lane finishes, the `~` is gone.
- [ ] **The prompt box never locks.** Send a second prompt while lanes are still
      streaming. The old lanes stop cleanly and say why; the new prompt goes.

## The server owns the answer

- [ ] **Reload mid-answer.** Refresh while lanes are streaming, then reopen the
      thread from the sidebar. The answers are there and complete. A lane the
      server is still writing says "Still being written", **not** "didn't
      finish".
- [ ] **Close the tab mid-answer.** Same thing, harder. Reopen from the sidebar
      later: the answer was saved anyway.
- [ ] **On-screen equals stored.** Note a finished lane's numbers, reload the
      page. Identical, not merely similar.

## Voting

- [ ] **Two finished answers unlock the vote,** not three. Pick a winner the
      instant the second lane finishes — it is accepted first try, and the third
      lane goes on to finish normally.
- [ ] **One winner.** The winner is marked, the others dim, every answer stays
      readable.
- [ ] **A vote survives a reload.**

## Threads

- [ ] **A first send creates one thread,** and the address bar picks it up
      without killing the running streams.
- [ ] **Two prompts in a row, fast** — send a second before the first responds.
      Both land in the **same** thread in the sidebar.
- [ ] **New chat clears the arena** and does not adopt the previous thread.
- [ ] **A follow-up continues each model's own conversation** — a model that
      failed the previous turn does not pretend to remember it.

## Sharing

- [ ] **A thread starts private.** Its `/arena/{id}` URL lands on not-found for
      another account and when signed out.
- [ ] **Create share link makes a new `/share/{token}` URL.** It renders signed
      out with the same answers and real metrics, with no mutation controls.
- [ ] **Unshare revokes a copied URL immediately.** Sharing again creates a
      different URL and the old one stays revoked.
- [ ] **Shared metadata is generic and noindex.** It does not contain the
      thread title, prompt or answer text.
- [ ] **Delete asks twice, then removes the thread.** Its owner URL and shared
      URL both land on not-found afterwards.
- [ ] **Made-up thread ids and share tokens land on not-found,** not on an
      error screen.

## Failure

- [ ] **A failed lane offers Retry,** and retrying refills the same card —
      no second card appears for that model.
- [ ] **A failed lane never blocks the others,** and a turn with one failure can
      still be voted on if two others answered.
- [ ] **No raw error text anywhere.** Every failure is a plain sentence.

## Accessibility

- [ ] **Keyboard only.** Tab to the prompt box, pick models, send, vote.
- [ ] **Focus is always visible.**
- [ ] **Both themes.** Nothing unreadable in light or dark.
