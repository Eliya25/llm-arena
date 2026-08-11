import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { request as arcjetRequest } from "@arcjet/next";
import { getOwnThreads } from "@/app/arena/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import type { ModelBadge } from "@/components/app-shell/top-bar";
import { ArenaClient, type InitialTurn } from "@/components/arena/arena-client";
import {
  MessageScreen,
  messageScreenActionClass,
} from "@/components/message-screen";
import { ajPublicRead } from "@/lib/arcjet";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";

// Win record scoped to this thread: of the turns that got a vote, how many
// each participating model won. Global records are the leaderboard's job.
function threadBadges(
  turns: InitialTurn[],
  nameFor: (modelId: string) => string,
): ModelBadge[] {
  const votedTurns = turns.filter((turn) => turn.winnerModelId !== null);
  const modelIds = [
    ...new Set(turns.flatMap((turn) => turn.lanes.map((lane) => lane.modelId))),
  ];

  return modelIds
    .map((modelId) => {
      const participated = votedTurns.filter((turn) =>
        turn.lanes.some((lane) => lane.modelId === modelId),
      );
      const name = nameFor(modelId);
      return {
        id: modelId,
        initial: name.trim().charAt(0).toUpperCase(),
        label: name,
        wins: participated.filter((turn) => turn.winnerModelId === modelId)
          .length,
        total: participated.length,
      };
    })
    .filter((badge) => badge.total > 0);
}

// Public sharing turned this page into an unauthenticated database read that
// anyone holding a link can hammer, so it gets its own IP-keyed limit
// (docs/scope.md Feature 10). cache()d for the same reason loadThread is:
// generateMetadata and the page render both need the answer, and without
// sharing one decision a single page view would spend two tokens.
const allowRead = cache(async () => {
  const decision = await ajPublicRead.protect(await arcjetRequest(), {
    requested: 1,
  });
  if (decision.isDenied()) {
    console.error("Arcjet denied thread read", { reason: decision.reason });
    return false;
  }
  return true;
});

// cache() so the page and generateMetadata share one query per request.
const loadThread = cache((threadId: string) =>
  prisma.thread.findUnique({
    where: { id: threadId },
    include: {
      user: { select: { clerkId: true } },
      turns: {
        orderBy: { createdAt: "asc" },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          vote: true,
        },
      },
    },
  }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadId: string }>;
}): Promise<Metadata> {
  const { threadId } = await params;
  // Skip the query entirely when the read is being rate limited — the page
  // itself renders the plain "slow down" screen.
  if (!(await allowRead())) return {};
  const thread = await loadThread(threadId);
  return thread ? { title: `${thread.title} · LLM Arena` } : {};
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;

  // Before the database is touched: a denied read gets a plain sentence, not a
  // raw error and not a misleading not-found.
  if (!(await allowRead())) {
    return (
      <MessageScreen
        title="Too many requests"
        description="This thread is being loaded too often right now. Wait a moment, then try again."
        action={
          <Link href="/arena" className={messageScreenActionClass}>
            Back to the arena
          </Link>
        }
      />
    );
  }

  const { userId } = await auth();

  const [thread, catalog, threads] = await Promise.all([
    loadThread(threadId),
    getFreeModelCatalog(),
    getOwnThreads(),
  ]);
  // A thread is readable by anyone holding its link — the unguessable id is
  // the permission. Only a made-up or deleted id lands on not-found.
  if (!thread) notFound();

  // The owner gets the full arena; everyone else gets the same view read-only.
  // Writes stay owner-enforced server-side regardless of what renders here.
  const isOwner = userId !== null && thread.user.clerkId === userId;

  const nameFor = (modelId: string) =>
    catalog.find((model) => model.id === modelId)?.name ?? modelId;

  const initialTurns: InitialTurn[] = thread.turns.map((turn) => ({
    turnId: turn.id,
    prompt: turn.prompt,
    winnerModelId:
      turn.messages.find((message) => message.id === turn.vote?.messageId)
        ?.model ?? null,
    messageIds: Object.fromEntries(
      turn.messages.map((message) => [message.model, message.id]),
    ),
    lanes: turn.messages.map((message) => ({
      modelId: message.model,
      modelName: nameFor(message.model),
      text: message.content,
      status:
        message.status === "SUCCESS"
          ? ("done" as const)
          : message.status === "FAILED"
            ? ("error" as const)
            : ("unfinished" as const),
      errorMessage:
        message.status === "FAILED" ? "This model didn't answer." : undefined,
      ttftMs: message.timeToFirstTokenMs ?? undefined,
      tokensPerSecond: message.tokensPerSecond ?? undefined,
      totalTokens: message.totalTokens ?? undefined,
    })),
  }));

  return (
    <AppShell
      breadcrumb={thread.title}
      models={threadBadges(initialTurns, nameFor)}
      threads={threads}
      showCopyLink
    >
      <ArenaClient
        key={thread.id}
        catalog={catalog}
        initialThreadId={thread.id}
        initialTurns={initialTurns}
        readOnly={!isOwner}
      />
    </AppShell>
  );
}
