import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashShareToken, newShareToken } from "@/lib/thread-share";
import {
  createShareForOwner,
  deleteThreadForOwner,
  revokeShareForOwner,
} from "./thread-lifecycle";

const clerkIds: string[] = [];

async function makeThread() {
  const clerkId = `test-${crypto.randomUUID()}`;
  clerkIds.push(clerkId);
  const user = await prisma.user.create({ data: { clerkId } });
  const thread = await prisma.thread.create({
    data: { userId: user.id, title: "private by default" },
  });
  return { user, thread };
}

afterAll(async () => {
  await prisma.thread.deleteMany({
    where: { user: { clerkId: { in: clerkIds } } },
  });
  await prisma.user.deleteMany({ where: { clerkId: { in: clerkIds } } });
});

describe("thread sharing lifecycle", () => {
  it("leaves a new thread private until a share row exists", async () => {
    const { thread } = await makeThread();
    expect(
      await prisma.threadShare.findUnique({ where: { threadId: thread.id } }),
    ).toBeNull();
  });

  it("rotates the token and makes the previous link unusable", async () => {
    const { thread } = await makeThread();
    const first = newShareToken();
    const second = newShareToken();
    await prisma.threadShare.create({
      data: { threadId: thread.id, tokenHash: hashShareToken(first) },
    });
    await prisma.threadShare.update({
      where: { threadId: thread.id },
      data: { tokenHash: hashShareToken(second), revokedAt: null },
    });

    expect(
      await prisma.threadShare.findFirst({
        where: { tokenHash: hashShareToken(first), revokedAt: null },
      }),
    ).toBeNull();
    expect(
      await prisma.threadShare.findFirst({
        where: { tokenHash: hashShareToken(second), revokedAt: null },
      }),
    ).not.toBeNull();
  });

  it("revokes an active public link", async () => {
    const { thread } = await makeThread();
    const tokenHash = hashShareToken(newShareToken());
    await prisma.threadShare.create({
      data: { threadId: thread.id, tokenHash },
    });
    await prisma.threadShare.update({
      where: { threadId: thread.id },
      data: { revokedAt: new Date() },
    });
    expect(
      await prisma.threadShare.findFirst({
        where: { tokenHash, revokedAt: null },
      }),
    ).toBeNull();
  });

  it("deletes turns, messages, votes and the share with the thread", async () => {
    const { thread } = await makeThread();
    const turn = await prisma.turn.create({
      data: { threadId: thread.id, prompt: "prompt" },
    });
    const message = await prisma.message.create({
      data: {
        turnId: turn.id,
        model: "test/model",
        content: "answer",
        status: "SUCCESS",
      },
    });
    await prisma.vote.create({
      data: { turnId: turn.id, messageId: message.id },
    });
    await prisma.threadShare.create({
      data: { threadId: thread.id, tokenHash: hashShareToken(newShareToken()) },
    });

    await prisma.thread.delete({ where: { id: thread.id } });
    expect(await prisma.turn.findUnique({ where: { id: turn.id } })).toBeNull();
    expect(
      await prisma.message.findUnique({ where: { id: message.id } }),
    ).toBeNull();
    expect(
      await prisma.vote.findUnique({ where: { turnId: turn.id } }),
    ).toBeNull();
    expect(
      await prisma.threadShare.findUnique({ where: { threadId: thread.id } }),
    ).toBeNull();
  });

  it("refuses share, revoke and delete mutations from another owner", async () => {
    const mine = await makeThread();
    const stranger = await makeThread();
    expect(
      await createShareForOwner(stranger.user.id, mine.thread.id),
    ).toBeNull();

    const token = await createShareForOwner(mine.user.id, mine.thread.id);
    expect(token).not.toBeNull();
    expect(await revokeShareForOwner(stranger.user.id, mine.thread.id)).toBe(
      false,
    );
    expect(await deleteThreadForOwner(stranger.user.id, mine.thread.id)).toBe(
      false,
    );
    expect(
      await prisma.thread.findUnique({ where: { id: mine.thread.id } }),
    ).not.toBeNull();
  });
});
