import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type LeaderboardRow = {
  modelId: string;
  // Voted turns this model won / participated in — the same definition the
  // thread page's badges use, so the numbers agree everywhere.
  wins: number;
  total: number;
  // Averages over every SUCCESS answer (scoped to the owner for personal),
  // each one a stored real measurement; null when nothing was measured.
  avgTokensPerSecond: number | null;
  avgTimeToFirstTokenMs: number | null;
};

// Counted in the database rather than in Node (docs/scope-v2.md Feature 7).
//
// This used to fetch every voted turn with all of its messages and tally them
// in JavaScript. Correct, and fine at the traffic this app has. Measured at
// 100,000 turns it was **1,585ms and 160,003 rows shipped into Node** for one
// page view; the same answer computed here is 316ms and three rows.
//
// The rules are unchanged, and are worth reading off the SQL:
//
//   participation  one record per model per voted turn, so a model that
//                  somehow answered a turn twice still counts once — that is
//                  what GROUP BY ("turnId", model) is doing.
//   a win          the vote points at one of that model's messages.
//   averages       over SUCCESS answers only, and null when nothing was
//                  measured rather than zero, because a model with no
//                  measurements is not the slowest model in the arena.
//   order          wins, then win rate, then model id — the last so a dead
//                  heat renders the same way on every page load.
//
// Written as SQL rather than through the query builder because the shape is a
// grouped aggregate over a join, which is the thing SQL is for.
function countedRows(scope: Prisma.Sql) {
  return prisma.$queryRaw<
    {
      modelId: string;
      wins: bigint;
      total: bigint;
      avgTokensPerSecond: number | null;
      avgTimeToFirstTokenMs: number | null;
    }[]
  >`
    WITH participation AS (
      SELECT v."turnId",
             m.model,
             bool_or(m.id = v."messageId") AS won
      FROM "Vote" v
      JOIN "Message" m ON m."turnId" = v."turnId"
      JOIN "Turn" t ON t.id = v."turnId"
      JOIN "Thread" th ON th.id = t."threadId"
      JOIN "User" u ON u.id = th."userId"
      WHERE ${scope}
      GROUP BY v."turnId", m.model
    ),
    tally AS (
      SELECT model,
             count(*) AS total,
             count(*) FILTER (WHERE won) AS wins
      FROM participation
      GROUP BY model
    ),
    averages AS (
      SELECT m.model,
             avg(m."tokensPerSecond") AS tps,
             avg(m."timeToFirstTokenMs") AS ttft
      FROM "Message" m
      JOIN "Turn" t ON t.id = m."turnId"
      JOIN "Thread" th ON th.id = t."threadId"
      JOIN "User" u ON u.id = th."userId"
      WHERE m.status = 'SUCCESS' AND ${scope}
      GROUP BY m.model
    )
    SELECT tally.model                AS "modelId",
           tally.wins                 AS wins,
           tally.total                AS total,
           round(averages.tps)::int   AS "avgTokensPerSecond",
           round(averages.ttft)::int  AS "avgTimeToFirstTokenMs"
    FROM tally
    LEFT JOIN averages ON averages.model = tally.model
    ORDER BY tally.wins DESC,
             tally.wins::float / tally.total DESC,
             tally.model ASC
  `;
}

export async function computeRows(
  clerkId: string | null,
): Promise<LeaderboardRow[]> {
  // The global board counts everyone; the personal one counts only the
  // signed-in user's own threads. Parameterised by Prisma.sql, never
  // interpolated into the statement.
  const scope = clerkId
    ? Prisma.sql`u."clerkId" = ${clerkId}`
    : Prisma.sql`TRUE`;

  const counted = await countedRows(scope);

  // count() comes back as bigint, which cannot cross into a client component.
  // These are counts of turns, so Number is exact.
  return counted.map((row) => ({
    modelId: row.modelId,
    wins: Number(row.wins),
    total: Number(row.total),
    avgTokensPerSecond: row.avgTokensPerSecond,
    avgTimeToFirstTokenMs: row.avgTimeToFirstTokenMs,
  }));
}
