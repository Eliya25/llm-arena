"use server";

import { auth } from "@clerk/nextjs/server";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";
import { getPostHogClient } from "@/lib/posthog-server";

const MAX_MODELS = 3;
const THREAD_TITLE_LENGTH = 80;
// Mirrors /api/chat's per-message cap — a turn that persistence accepts must
// also be one streaming accepts, or the database fills with unrunnable turns.
const MAX_PROMPT_LENGTH = 32_000;

const SIGN_IN_ERROR = "Please sign in to do that.";
const GENERIC_ERROR = "Something went wrong saving this. Please try again.";

type ActionError = { error: string };

export type CreateTurnResult =
  | {
      threadId: string;
      turnId: string;
      // model id → message row id, so each lane knows which row to finish.
      messageIds: Record<string, string>;
    }
  | ActionError;

export type ThreadListItem = { id: string; title: string };

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
    console.error("getOwnThreads failed", cause);
    return [];
  }
}

async function requireUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return prisma.user.upsert({
    where: { clerkId: userId },
    create: { clerkId: userId },
    update: {},
  });
}

export async function createTurn(input: {
  threadId: string | null;
  prompt: string;
  modelIds: string[];
}): Promise<CreateTurnResult> {
  try {
    const prompt = input.prompt.trim();
    const modelIds = [...new Set(input.modelIds)];
    if (
      prompt.length === 0 ||
      modelIds.length === 0 ||
      modelIds.length > MAX_MODELS
    ) {
      return { error: GENERIC_ERROR };
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return { error: "That prompt is too long. Please shorten it." };
    }

    // Same allowlist /api/chat enforces: only models from the server's own
    // free-tier catalog. A failed catalog fetch fails closed, like the route.
    const catalog = await getFreeModelCatalog();
    if (!modelIds.every((id) => catalog.some((model) => model.id === id))) {
      return {
        error: "Those models aren't available here. Pick from the model list.",
      };
    }

    const user = await requireUser();
    if (!user) return { error: SIGN_IN_ERROR };

    // A follow-up must land in a thread this user actually owns.
    const thread = input.threadId
      ? await prisma.thread.findFirst({
          where: { id: input.threadId, userId: user.id },
        })
      : await prisma.thread.create({
          data: {
            userId: user.id,
            title: prompt.slice(0, THREAD_TITLE_LENGTH),
          },
        });
    if (!thread) return { error: GENERIC_ERROR };

    const turn = await prisma.turn.create({
      data: {
        threadId: thread.id,
        prompt,
        messages: {
          create: modelIds.map((model) => ({ model, content: "" })),
        },
      },
      include: { messages: true },
    });

    return {
      threadId: thread.id,
      turnId: turn.id,
      messageIds: Object.fromEntries(
        turn.messages.map((message) => [message.model, message.id]),
      ),
    };
  } catch (cause) {
    console.error("createTurn failed", cause);
    return { error: GENERIC_ERROR };
  }
}

async function findOwnedMessage(messageId: string) {
  const user = await requireUser();
  if (!user) return null;
  return prisma.message.findFirst({
    where: { id: messageId, turn: { thread: { userId: user.id } } },
  });
}

export async function completeMessage(input: {
  messageId: string;
  content: string;
  ttftMs?: number;
  tokensPerSecond?: number;
  totalTokens?: number;
}): Promise<{ ok: true } | ActionError> {
  try {
    const message = await findOwnedMessage(input.messageId);
    if (!message) return { error: SIGN_IN_ERROR };

    const asInt = (value: number | undefined) =>
      value !== undefined && Number.isFinite(value) && value >= 0
        ? Math.round(value)
        : null;

    await prisma.message.update({
      where: { id: message.id },
      data: {
        content: input.content,
        status: "SUCCESS",
        timeToFirstTokenMs: asInt(input.ttftMs),
        tokensPerSecond:
          input.tokensPerSecond !== undefined &&
          Number.isFinite(input.tokensPerSecond) &&
          input.tokensPerSecond >= 0
            ? input.tokensPerSecond
            : null,
        totalTokens: asInt(input.totalTokens),
      },
    });
    return { ok: true };
  } catch (cause) {
    console.error("completeMessage failed", cause);
    return { error: GENERIC_ERROR };
  }
}

export async function failMessage(input: {
  messageId: string;
}): Promise<{ ok: true } | ActionError> {
  try {
    const message = await findOwnedMessage(input.messageId);
    if (!message) return { error: SIGN_IN_ERROR };

    await prisma.message.update({
      where: { id: message.id },
      data: { status: "FAILED" },
    });
    return { ok: true };
  } catch (cause) {
    console.error("failMessage failed", cause);
    return { error: GENERIC_ERROR };
  }
}

export async function castVote(input: {
  turnId: string;
  messageId: string;
}): Promise<{ ok: true } | ActionError> {
  try {
    const user = await requireUser();
    if (!user) return { error: SIGN_IN_ERROR };

    const turn = await prisma.turn.findFirst({
      where: { id: input.turnId, thread: { userId: user.id } },
      include: { messages: true, vote: true },
    });
    if (!turn) return { error: GENERIC_ERROR };
    if (turn.vote) {
      return { error: "This turn already has a winner." };
    }

    const winner = turn.messages.find(
      (message) =>
        message.id === input.messageId && message.status === "SUCCESS",
    );
    const answered = turn.messages.filter(
      (message) => message.status === "SUCCESS",
    ).length;
    // The rule: a vote only exists once two or more models actually answered.
    if (!winner || answered < 2) {
      return { error: "A vote needs at least two finished answers." };
    }

    await prisma.vote.create({
      data: { turnId: turn.id, messageId: winner.id },
    });

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: user.clerkId,
        event: "vote_cast",
        properties: {
          turn_id: turn.id,
          winner_model: winner.model,
          answered_models: answered,
        },
      });
      await posthog.flush();
    }

    return { ok: true };
  } catch (cause) {
    console.error("castVote failed", cause);
    // The @unique on turnId means a double-vote lands here, not silently.
    return { error: GENERIC_ERROR };
  }
}
