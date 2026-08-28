import { prisma } from "@/lib/prisma";
import { hashShareToken, newShareToken } from "@/lib/thread-share";

export async function createShareForOwner(userId: string, threadId: string) {
  const owned = await prisma.thread.findFirst({
    where: { id: threadId, userId },
    select: { id: true },
  });
  if (!owned) return null;

  const token = newShareToken();
  await prisma.threadShare.upsert({
    where: { threadId },
    create: { threadId, tokenHash: hashShareToken(token) },
    update: {
      tokenHash: hashShareToken(token),
      createdAt: new Date(),
      revokedAt: null,
    },
  });
  return token;
}

export async function revokeShareForOwner(userId: string, threadId: string) {
  const result = await prisma.threadShare.updateMany({
    where: { threadId, revokedAt: null, thread: { userId } },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function deleteThreadForOwner(userId: string, threadId: string) {
  const result = await prisma.thread.deleteMany({
    where: { id: threadId, userId },
  });
  return result.count === 1;
}
