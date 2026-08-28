import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getOwnThreads } from "@/app/arena/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import type { ModelBadge } from "@/components/app-shell/top-bar";
import { ArenaClient, type InitialTurn } from "@/components/arena/arena-client";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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

const loadOwnedThread = cache((threadId: string, clerkId: string) =>
  prisma.thread.findFirst({
    where: { id: threadId, user: { clerkId } },
    include: {
      share: { select: { revokedAt: true } },
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

function initialTurnsFrom(
  thread: NonNullable<Awaited<ReturnType<typeof loadOwnedThread>>>,
  nameFor: (modelId: string) => string,
): InitialTurn[] {
  return thread.turns.map((turn) => ({
    turnId: turn.id,
    prompt: turn.prompt,
    winnerModelId:
      turn.messages.find((message) => message.id === turn.vote?.messageId)
        ?.model ?? null,
    lanes: turn.messages.map((message) => ({
      modelId: message.model,
      modelName: nameFor(message.model),
      messageId: message.id,
      text: message.content,
      status:
        message.status === "SUCCESS"
          ? ("done" as const)
          : message.status === "FAILED"
            ? ("error" as const)
            : ("unfinished" as const),
      errorMessage:
        message.status === "STREAMING"
          ? "Still being written · reload in a moment."
          : message.status !== "FAILED"
            ? undefined
            : message.content.length > 0
              ? "This answer stopped partway through."
              : "This model didn't answer.",
      ttftMs: message.timeToFirstTokenMs ?? undefined,
      tokensPerSecond:
        message.tokensPerSecond !== null
          ? Math.round(message.tokensPerSecond)
          : undefined,
      outputTokens: message.outputTokens ?? undefined,
    })),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadId: string }>;
}): Promise<Metadata> {
  const [{ threadId }, { userId }] = await Promise.all([params, auth()]);
  if (!userId) return {};
  const thread = await loadOwnedThread(threadId, userId);
  return thread ? { title: `${thread.title} · LLM Arena` } : {};
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const [{ threadId }, { userId }] = await Promise.all([params, auth()]);
  if (!userId) notFound();
  const [thread, catalog, threads] = await Promise.all([
    loadOwnedThread(threadId, userId),
    getFreeModelCatalog(),
    getOwnThreads(),
  ]);
  if (!thread) notFound();

  const nameFor = (modelId: string) =>
    catalog.find((model) => model.id === modelId)?.name ?? modelId;
  const initialTurns = initialTurnsFrom(thread, nameFor);

  return (
    <AppShell
      breadcrumb={thread.title}
      models={threadBadges(initialTurns, nameFor)}
      threads={threads}
      threadControls={{
        threadId: thread.id,
        initiallyShared: thread.share?.revokedAt === null,
      }}
    >
      <ArenaClient
        key={thread.id}
        catalog={catalog}
        initialThreadId={thread.id}
        initialTurns={initialTurns}
        readOnly={false}
      />
    </AppShell>
  );
}
