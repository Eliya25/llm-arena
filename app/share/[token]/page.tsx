import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { request as arcjetRequest } from "@arcjet/next";
import { getOwnThreads } from "@/app/arena/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ArenaClient, type InitialTurn } from "@/components/arena/arena-client";
import {
  MessageScreen,
  messageScreenActionClass,
} from "@/components/message-screen";
import { ajPublicRead } from "@/lib/arcjet";
import { getFreeModelCatalog } from "@/lib/openrouter";
import { prisma } from "@/lib/prisma";
import { hashShareToken, isValidShareToken } from "@/lib/thread-share";
import { log, newRequestId } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared comparison · LLM Arena",
  description: "A read-only AI model comparison shared from LLM Arena.",
  robots: { index: false, follow: false },
};

const allowRead = cache(async () => {
  const decision = await ajPublicRead.protect(await arcjetRequest(), {
    requested: 1,
  });
  if (!decision.isDenied()) return true;
  log.warn(
    "security_denied",
    { requestId: newRequestId() },
    { surface: "public-thread-read", reason: decision.reason.type },
  );
  return false;
});

const loadSharedThread = cache((tokenHash: string) =>
  prisma.threadShare.findFirst({
    where: { tokenHash, revokedAt: null },
    select: {
      thread: {
        include: {
          turns: {
            orderBy: { createdAt: "asc" },
            include: {
              messages: { orderBy: { createdAt: "asc" } },
              vote: true,
            },
          },
        },
      },
    },
  }),
);

export default async function SharedThreadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isValidShareToken(token)) notFound();
  if (!(await allowRead())) {
    return (
      <MessageScreen
        title="Too many requests"
        description="This shared thread is being loaded too often. Wait a moment, then try again."
        action={
          <Link href="/arena" className={messageScreenActionClass}>
            Back to the arena
          </Link>
        }
      />
    );
  }

  const [shared, catalog, threads] = await Promise.all([
    loadSharedThread(hashShareToken(token)),
    getFreeModelCatalog(),
    getOwnThreads(),
  ]);
  if (!shared) notFound();
  const { thread } = shared;
  const nameFor = (modelId: string) =>
    catalog.find((model) => model.id === modelId)?.name ?? modelId;
  const initialTurns: InitialTurn[] = thread.turns.map((turn) => ({
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

  return (
    <AppShell breadcrumb="Shared comparison" threads={threads}>
      <ArenaClient
        key={thread.id}
        catalog={catalog}
        initialThreadId={thread.id}
        initialTurns={initialTurns}
        readOnly
      />
    </AppShell>
  );
}
