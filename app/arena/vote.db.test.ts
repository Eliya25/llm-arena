import { afterAll, describe, expect, it } from "vitest";
import { claimAnswerRow } from "@/app/api/chat/answer-row";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// judgeVote decides whether a vote is allowed, and is checked on its own in
// vote-rules.test.ts. This is the guarantee underneath it: even if two
// requests both pass the rule at the same instant, the database only lets one
// vote exist.

const users: string[] = [];

const votableTurn = async () => {
  const clerkId = `test-${crypto.randomUUID()}`;
  users.push(clerkId);
  const clientKey = crypto.randomUUID();
  const threadKey = crypto.randomUUID();

  const claims = await Promise.all(
    ["model/a", "model/b"].map((model) =>
      claimAnswerRow({
        target: { clientKey, threadKey },
        model,
        prompt: "a prompt",
        clerkId,
        trace: { requestId: `test-${crypto.randomUUID()}` },
      }),
    ),
  );

  // Both answered, so the turn is votable.
  for (const claim of claims) {
    await prisma.message.update({
      where: { id: claim?.messageId },
      data: { status: "SUCCESS", content: "an answer" },
    });
  }

  return {
    turnId: claims[0]?.turnId ?? "",
    winners: claims.map((claim) => claim?.messageId ?? ""),
  };
};

afterAll(async () => {
  const turns = await prisma.turn.findMany({
    where: { thread: { user: { clerkId: { in: users } } } },
    select: { id: true },
  });
  const turnIds = turns.map((turn) => turn.id);
  await prisma.vote.deleteMany({ where: { turnId: { in: turnIds } } });
  await prisma.message.deleteMany({ where: { turnId: { in: turnIds } } });
  await prisma.turn.deleteMany({ where: { id: { in: turnIds } } });
  await prisma.thread.deleteMany({
    where: { user: { clerkId: { in: users } } },
  });
  await prisma.user.deleteMany({ where: { clerkId: { in: users } } });
});

describe("one turn, one winner", () => {
  it("refuses a second vote even when two arrive together", async () => {
    // A double-click, or a retried server action. The rule check can pass
    // twice; the constraint cannot.
    const { turnId, winners } = await votableTurn();

    const results = await Promise.allSettled(
      winners.map((messageId) =>
        prisma.vote.create({ data: { turnId, messageId } }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect(refused?.status).toBe("rejected");
    if (refused?.status === "rejected") {
      expect(refused.reason).toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      // A unique violation, not some incidental failure.
      expect(refused.reason.code).toBe("P2002");
    }

    expect(await prisma.vote.count({ where: { turnId } })).toBe(1);
  });

  it("keeps the first winner when a second vote is attempted later", async () => {
    const { turnId, winners } = await votableTurn();
    await prisma.vote.create({ data: { turnId, messageId: winners[0] } });

    await expect(
      prisma.vote.create({ data: { turnId, messageId: winners[1] } }),
    ).rejects.toMatchObject({ code: "P2002" });

    const vote = await prisma.vote.findUnique({ where: { turnId } });
    expect(vote?.messageId).toBe(winners[0]);
  });
});
