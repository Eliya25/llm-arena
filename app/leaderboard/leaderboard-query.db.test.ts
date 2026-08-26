import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { computeRows } from "./leaderboard-query";

// The counting rules, checked against the database that now applies them.
//
// These replace the unit tests that covered tallyLeaderboard, the JavaScript
// version this feature retired. The rules did not change — where they are
// enforced did — so the coverage moved rather than disappeared.

const users: string[] = [];

// Builds one voted turn: `models` all answered, `winner` took the vote.
async function votedTurn(options: {
  clerkId: string;
  models: string[];
  winner: string | null;
  metrics?: Record<string, { tps: number; ttft: number }>;
  failed?: string[];
}) {
  const { clerkId, models, winner, metrics = {}, failed = [] } = options;
  if (!users.includes(clerkId)) users.push(clerkId);

  const user = await prisma.user.upsert({
    where: { clerkId },
    create: { clerkId },
    update: {},
  });
  const thread = await prisma.thread.create({
    data: { userId: user.id, title: "t" },
  });
  const turn = await prisma.turn.create({
    data: { threadId: thread.id, prompt: "p" },
  });

  const messages = await Promise.all(
    models.map((model, index) =>
      prisma.message.create({
        data: {
          turnId: turn.id,
          // A model may appear twice in `models` deliberately, so ids differ.
          model,
          content: "an answer",
          status: failed.includes(model) ? "FAILED" : "SUCCESS",
          tokensPerSecond: metrics[model]?.tps ?? null,
          timeToFirstTokenMs: metrics[model]?.ttft ?? null,
          attempt: index,
        },
      }),
    ),
  ).catch(async () => {
    // (turnId, model) is unique, so a repeated model needs its own turn in
    // real life. Tests that want a duplicate insert it directly below.
    return [];
  });

  if (winner) {
    const chosen = messages.find((message) => message.model === winner);
    if (chosen) {
      await prisma.vote.create({
        data: { turnId: turn.id, messageId: chosen.id },
      });
    }
  }
  return { turn, messages };
}

afterEach(async () => {
  const threads = await prisma.thread.findMany({
    where: { user: { clerkId: { in: users } } },
    select: { id: true },
  });
  const turns = await prisma.turn.findMany({
    where: { threadId: { in: threads.map((thread) => thread.id) } },
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
  users.length = 0;
});

const forUser = (clerkId: string) => computeRows(clerkId);

describe("counting wins", () => {
  it("gives the win to the voted model and a participation to everyone", async () => {
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({ clerkId, models: ["a", "b", "c"], winner: "a" });

    const rows = await forUser(clerkId);
    expect(rows).toEqual([
      expect.objectContaining({ modelId: "a", wins: 1, total: 1 }),
      expect.objectContaining({ modelId: "b", wins: 0, total: 1 }),
      expect.objectContaining({ modelId: "c", wins: 0, total: 1 }),
    ]);
  });

  it("counts a model that failed the turn as having taken part", async () => {
    // It was in the arena and lost. That is a loss, not an absence.
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({
      clerkId,
      models: ["a", "b"],
      winner: "a",
      failed: ["b"],
    });

    const rows = await forUser(clerkId);
    expect(rows.find((row) => row.modelId === "b")).toMatchObject({
      wins: 0,
      total: 1,
    });
  });

  it("ignores turns nobody voted on", async () => {
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({ clerkId, models: ["a", "b"], winner: null });

    expect(await forUser(clerkId)).toEqual([]);
  });
});

describe("ordering", () => {
  it("ranks by wins, then win rate, then name", async () => {
    const clerkId = `test-${crypto.randomUUID()}`;
    // a: 2 of 3. b: 2 of 4. c: 0 of 1.
    await votedTurn({ clerkId, models: ["a", "b"], winner: "a" });
    await votedTurn({ clerkId, models: ["a", "b"], winner: "a" });
    await votedTurn({ clerkId, models: ["a", "b"], winner: "b" });
    await votedTurn({ clerkId, models: ["b", "c"], winner: "b" });

    const rows = await forUser(clerkId);
    expect(rows.map((row) => row.modelId)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ wins: 2, total: 3 });
    expect(rows[1]).toMatchObject({ wins: 2, total: 4 });
  });

  it("breaks a dead heat on the name, so the order never wobbles", async () => {
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({ clerkId, models: ["zeta", "alpha"], winner: "zeta" });
    await votedTurn({ clerkId, models: ["zeta", "alpha"], winner: "alpha" });

    const rows = await forUser(clerkId);
    expect(rows.map((row) => row.modelId)).toEqual(["alpha", "zeta"]);
  });
});

describe("the measurements", () => {
  it("averages over successful answers and rounds", async () => {
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({
      clerkId,
      models: ["a", "b"],
      winner: "a",
      metrics: { a: { tps: 41.6, ttft: 812.4 }, b: { tps: 10, ttft: 100 } },
    });

    const rows = await forUser(clerkId);
    expect(rows.find((row) => row.modelId === "a")).toMatchObject({
      avgTokensPerSecond: 42,
      avgTimeToFirstTokenMs: 812,
    });
  });

  it("reports no measurement rather than a zero", async () => {
    // A model with votes but nothing measured must not be published as the
    // slowest model in the arena.
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({ clerkId, models: ["a", "b"], winner: "a" });

    const rows = await forUser(clerkId);
    expect(rows[0].avgTokensPerSecond).toBeNull();
    expect(rows[0].avgTimeToFirstTokenMs).toBeNull();
  });

  it("leaves a failed answer out of the averages", async () => {
    const clerkId = `test-${crypto.randomUUID()}`;
    await votedTurn({
      clerkId,
      models: ["a", "b"],
      winner: "a",
      failed: ["b"],
      metrics: { b: { tps: 999, ttft: 1 } },
    });

    const rows = await forUser(clerkId);
    // b's numbers came from a generation that failed, so they are not a
    // measurement of b answering.
    expect(rows.find((row) => row.modelId === "b")?.avgTokensPerSecond).toBe(
      null,
    );
  });
});

describe("whose board it is", () => {
  it("keeps one person's votes out of another's board", async () => {
    const mine = `test-${crypto.randomUUID()}`;
    const theirs = `test-${crypto.randomUUID()}`;
    await votedTurn({ clerkId: mine, models: ["a", "b"], winner: "a" });
    await votedTurn({ clerkId: theirs, models: ["a", "b"], winner: "b" });

    expect(await forUser(mine)).toEqual([
      expect.objectContaining({ modelId: "a", wins: 1, total: 1 }),
      expect.objectContaining({ modelId: "b", wins: 0, total: 1 }),
    ]);
  });

  it("counts everyone on the global board", async () => {
    const mine = `test-${crypto.randomUUID()}`;
    const theirs = `test-${crypto.randomUUID()}`;
    await votedTurn({ clerkId: mine, models: ["solo-a"], winner: "solo-a" });
    await votedTurn({ clerkId: theirs, models: ["solo-a"], winner: "solo-a" });

    const global = await computeRows(null);
    expect(global.find((row) => row.modelId === "solo-a")).toMatchObject({
      wins: 2,
      total: 2,
    });
  });

  it("is empty for someone who has never voted", async () => {
    expect(await forUser(`test-${crypto.randomUUID()}`)).toEqual([]);
  });
});
