"use server";

import { auth } from "@clerk/nextjs/server";
import { request as arcjetRequest } from "@arcjet/next";
import { revalidatePath } from "next/cache";
import { ajActions } from "@/lib/arcjet";
import { prisma } from "@/lib/prisma";
import { track } from "@/lib/analytics";
import { describeCause, log, newRequestId } from "@/lib/telemetry";
import { judgeVote } from "./vote-rules";
import {
  createShareForOwner,
  deleteThreadForOwner,
  revokeShareForOwner,
} from "./thread-lifecycle";

const SIGN_IN_ERROR = "Please sign in to do that.";
const GENERIC_ERROR = "Something went wrong saving this. Please try again.";
const RATE_LIMIT_ERROR =
  "You're doing that too quickly. Please wait a moment and try again.";

// One vote is one row, against the shared per-person bucket in lib/arcjet.ts.
// The heavier weighting createTurn used to carry left with it — threads, turns,
// and answer rows are now written by /api/chat, under that route's own limit.
const COST_SINGLE_WRITE = 1;

type ActionError = { error: string };
// Explicit, not inferred: an inferred union puts an optional `error` key on the
// success branch too, which stops `"error" in result` from narrowing.
type Authorized = { user: { id: string; clerkId: string } };

export type ThreadListItem = { id: string; title: string };
export type ShareResult = { ok: true; path: string } | ActionError;

// The sidebar's thread list. Returns [] rather than an error shape — a list
// that can't load (signed out, database down) just renders as empty, and the
// sidebar already has honest copy for that.
export async function getOwnThreads(): Promise<ThreadListItem[]> {
  try {
    const { userId } = await auth();
    if (!userId) return [];
    const threads = await prisma.thread.findMany({
      where: { user: { clerkId: userId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    });
    return threads;
  } catch (cause) {
    log.error(
      "thread_list_failed",
      { requestId: newRequestId() },
      { cause: describeCause(cause) },
    );
    return [];
  }
}

// Sign-in check plus the per-person rate limit, in that order, before the
// database is touched at all — the user upsert below is itself a write, so
// gating after it would leave the flood vector open (docs/scope.md Feature 10).
// Returns either the caller's user row or a plain-language error to hand back.
async function authorize(requested: number): Promise<Authorized | ActionError> {
  const { userId } = await auth();
  if (!userId) return { error: SIGN_IN_ERROR };

  const decision = await ajActions.protect(await arcjetRequest(), {
    userId,
    requested,
  });
  if (decision.isDenied()) {
    log.warn(
      "security_denied",
      { requestId: newRequestId(), userId },
      {
        surface: "server-action",
        reason: decision.reason.type,
        isRateLimit: decision.reason.isRateLimit(),
      },
    );
    return {
      error: decision.reason.isRateLimit() ? RATE_LIMIT_ERROR : GENERIC_ERROR,
    };
  }

  const user = await prisma.user.upsert({
    where: { clerkId: userId },
    create: { clerkId: userId },
    update: {},
  });
  return { user };
}

// Three write actions used to live here and none of them do any more.
//
// completeMessage/failMessage took the answer text and the metrics straight
// from the browser and only checked who owned the row, so a signed-in user
// could publish arbitrary text at a public thread URL under a model's name and
// feed invented speed numbers to the global leaderboard (removed in
// docs/scope.md Feature 12).
//
// createTurn wrote the thread, the turn, and one row per model, running in
// parallel with the streams — which meant /api/chat had to *find* the row it
// wanted afterwards, by polling, and silently dropped a finished answer when
// that write was slow. The route now creates what it needs before it calls the
// model (docs/scope-v2.md Feature 1). Everything about an answer — which rows
// exist, what they contain, what they measured — is written in one place, by
// the only side that sees the model's output.

export async function castVote(input: {
  turnId: string;
  messageId: string;
}): Promise<{ ok: true } | ActionError> {
  try {
    const authorized = await authorize(COST_SINGLE_WRITE);
    if ("error" in authorized) return authorized;
    const { user } = authorized;

    // Scoped to the caller: this query is what decides ownership, and it is
    // deliberately not something judgeVote is trusted to remember.
    const turn = await prisma.turn.findFirst({
      where: { id: input.turnId, thread: { userId: user.id } },
      include: { messages: true, vote: true },
    });
    if (!turn) return { error: GENERIC_ERROR };

    const verdict = judgeVote(
      { messages: turn.messages, hasVote: turn.vote !== null },
      input.messageId,
    );
    if (!verdict.ok) return { error: verdict.error };
    const { winner, answered } = verdict;

    await prisma.vote.create({
      data: { turnId: turn.id, messageId: winner.id },
    });

    track({
      distinctId: user.clerkId,
      event: "vote_cast",
      properties: {
        turn_id: turn.id,
        winner_model: winner.model,
        answered_models: answered,
      },
    });

    return { ok: true };
  } catch (cause) {
    log.error(
      "vote_failed",
      { requestId: newRequestId(), turnId: input.turnId },
      { cause: describeCause(cause) },
    );
    // The @unique on turnId means a double-vote lands here, not silently.
    return { error: GENERIC_ERROR };
  }
}

export async function shareThread(threadId: string): Promise<ShareResult> {
  try {
    const authorized = await authorize(COST_SINGLE_WRITE);
    if ("error" in authorized) return authorized;
    const token = await createShareForOwner(authorized.user.id, threadId);
    if (!token) return { error: GENERIC_ERROR };
    revalidatePath(`/arena/${threadId}`);
    return { ok: true, path: `/share/${token}` };
  } catch (cause) {
    log.error(
      "thread_share_failed",
      { requestId: newRequestId(), threadId },
      { cause: describeCause(cause) },
    );
    return { error: GENERIC_ERROR };
  }
}

export async function unshareThread(
  threadId: string,
): Promise<{ ok: true } | ActionError> {
  try {
    const authorized = await authorize(COST_SINGLE_WRITE);
    if ("error" in authorized) return authorized;
    if (!(await revokeShareForOwner(authorized.user.id, threadId))) {
      return { error: GENERIC_ERROR };
    }
    revalidatePath(`/arena/${threadId}`);
    return { ok: true };
  } catch (cause) {
    log.error(
      "thread_unshare_failed",
      { requestId: newRequestId(), threadId },
      { cause: describeCause(cause) },
    );
    return { error: GENERIC_ERROR };
  }
}

export async function deleteThread(
  threadId: string,
): Promise<{ ok: true } | ActionError> {
  try {
    const authorized = await authorize(COST_SINGLE_WRITE);
    if ("error" in authorized) return authorized;
    if (!(await deleteThreadForOwner(authorized.user.id, threadId))) {
      return { error: GENERIC_ERROR };
    }

    revalidatePath("/arena");
    return { ok: true };
  } catch (cause) {
    log.error(
      "thread_delete_failed",
      { requestId: newRequestId(), threadId },
      { cause: describeCause(cause) },
    );
    return { error: GENERIC_ERROR };
  }
}
