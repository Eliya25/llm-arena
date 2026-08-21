import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const THREAD_TITLE_LENGTH = 80;
const UNIQUE_VIOLATION = "P2002";
// Well past both stall watchdogs (120s to a first token, 60s between tokens),
// so an answer genuinely still arriving is not swept up with the dead ones.
const ABANDONED_AFTER_MS = 15 * 60 * 1000;

// Where an answer belongs. `turnId` when the turn already exists — a retry, or
// a lane restarted on a reloaded thread. Otherwise the client-generated keys
// the three lanes of one new prompt converge on: `threadKey` opens a new
// thread, `threadId` continues an existing one.
//
// None of these carry an answer or a measurement. They only say *which row*,
// and every one of them is resolved through the relation chain to the signed-in
// user, so no key can reach somebody else's thread.
export type AnswerTarget = {
  turnId?: string;
  clientKey?: string;
  threadId?: string;
  threadKey?: string;
};

export type AnswerRow = {
  threadId: string;
  turnId: string;
  messageId: string;
  // The try this request owns. Every write it makes names this number, so a
  // previous attempt still streaming somewhere cannot write over it.
  attempt: number;
};

// A row about to be streamed into. Also what a retry resets its row back to,
// so a half-written previous attempt can't sit next to the new one.
const blankAnswer = {
  content: "",
  status: "PENDING",
  timeToFirstTokenMs: null,
  generationDurationMs: null,
  tokensPerSecond: null,
  inputTokens: null,
  outputTokens: null,
} as const;

// Three lanes of the same prompt run this at the same moment with the same
// key. Whoever loses the unique index re-reads instead of failing: the row the
// winner just created is the row this lane wanted. The re-read is scoped to the
// caller like the first read was, so a key belonging to somebody else's thread
// returns null here rather than being adopted.
async function findOrCreate<T>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T | null> {
  const existing = await find();
  if (existing) return existing;
  try {
    return await create();
  } catch (cause) {
    if (
      cause instanceof Prisma.PrismaClientKnownRequestError &&
      cause.code === UNIQUE_VIOLATION
    ) {
      return find();
    }
    throw cause;
  }
}

// The guarantee behind "no row ends its life PENDING". The route's watchdogs
// already close out a generation that goes quiet, and a live check confirmed
// they do it even after the browser has gone. What they cannot survive is the
// process itself dying — a deploy, a crash — which takes every in-flight timer
// with it and strands whatever rows were open. So the next thing this user
// does closes out anything of theirs left hanging far longer than any live
// request could still be writing it. Best-effort by nature: a failure here
// must never stop the answer the caller is actually asking for.
async function closeAbandonedAnswers(userId: string) {
  try {
    await prisma.message.updateMany({
      where: {
        status: { in: ["PENDING", "STREAMING"] },
        createdAt: { lt: new Date(Date.now() - ABANDONED_AFTER_MS) },
        turn: { thread: { userId } },
      },
      data: { status: "FAILED" },
    });
  } catch (cause) {
    console.error("Sweeping abandoned answers failed", { userId, cause });
  }
}

async function resolveThread(
  target: AnswerTarget,
  userId: string,
  prompt: string,
): Promise<{ id: string } | null> {
  if (target.threadId) {
    // A follow-up has to land in a thread this user actually owns.
    return prisma.thread.findFirst({
      where: { id: target.threadId, userId },
      select: { id: true },
    });
  }
  if (!target.threadKey) return null;
  return findOrCreate(
    () =>
      prisma.thread.findFirst({
        where: { clientKey: target.threadKey, userId },
        select: { id: true },
      }),
    () =>
      prisma.thread.create({
        data: {
          userId,
          clientKey: target.threadKey,
          title: prompt.slice(0, THREAD_TITLE_LENGTH),
        },
        select: { id: true },
      }),
  );
}

async function resolveTurn(
  target: AnswerTarget,
  userId: string,
  prompt: string,
): Promise<{ id: string; threadId: string } | null> {
  if (target.turnId) {
    return prisma.turn.findFirst({
      where: { id: target.turnId, thread: { userId } },
      select: { id: true, threadId: true },
    });
  }
  if (!target.clientKey) return null;

  const thread = await resolveThread(target, userId, prompt);
  if (!thread) return null;

  return findOrCreate(
    () =>
      prisma.turn.findFirst({
        where: { clientKey: target.clientKey, thread: { userId } },
        select: { id: true, threadId: true },
      }),
    () =>
      prisma.turn.create({
        data: { threadId: thread.id, prompt, clientKey: target.clientKey },
        select: { id: true, threadId: true },
      }),
  );
}

// Resolves — creating where needed — the exact Message row this request is
// about to stream into, *before* the model is called. That ordering is the
// whole point: by the time a token exists there is provably a row to write it
// to. It replaces a lookup that ran after the stream ended and polled for a row
// a parallel server action might not have created yet, where a slow write meant
// a finished answer was silently dropped.
//
// Returns null when nothing here belongs to the caller, which the route turns
// into a plain sentence rather than a raw error.
export async function claimAnswerRow(params: {
  target: AnswerTarget;
  model: string;
  prompt: string;
  clerkId: string;
}): Promise<AnswerRow | null> {
  const { target, model, prompt, clerkId } = params;

  const user = await findOrCreate(
    () => prisma.user.findUnique({ where: { clerkId }, select: { id: true } }),
    () => prisma.user.create({ data: { clerkId }, select: { id: true } }),
  );
  if (!user) return null;
  await closeAbandonedAnswers(user.id);

  const turn = await resolveTurn(target, user.id, prompt);
  if (!turn) return null;

  const ids = { threadId: turn.threadId, turnId: turn.id };

  // First make sure the row exists at all...
  const row = await findOrCreate(
    () =>
      prisma.message.findUnique({
        where: { turnId_model: { turnId: turn.id, model } },
        select: { id: true },
      }),
    () =>
      prisma.message.create({
        data: { turnId: turn.id, model, ...blankAnswer },
        select: { id: true },
      }),
  );
  if (!row) return null;

  // ...then take ownership of it, always by increment — including on a row
  // this request just created, because two requests that raced into creating
  // it would otherwise both believe they own attempt 0 and both write.
  //
  // For a retry the increment is the handover: whatever was still writing to
  // this row for the previous try now names an attempt the row no longer
  // holds, so its updates match nothing and it stops. It happens in the same
  // statement that blanks the row, so there is no moment where an attempt is
  // claimed but not yet protected.
  const claimed = await prisma.message.update({
    where: { id: row.id },
    data: { ...blankAnswer, attempt: { increment: 1 } },
    select: { id: true, attempt: true },
  });
  return { ...ids, messageId: claimed.id, attempt: claimed.attempt };
}
