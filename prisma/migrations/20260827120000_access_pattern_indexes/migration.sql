-- Two indexes, kept because measurement earned them (docs/scope-v2.md
-- Feature 7). The schema had none at all beyond primary keys and unique
-- constraints, and Postgres does not index a foreign key on its own.
--
-- Opening a thread was scanning every turn in the table to find five:
--   100,000 turns — 5.4ms sequential scan, 0.4ms after.
CREATE INDEX "Turn_threadId_createdAt_idx" ON "Turn"("threadId", "createdAt");

-- The sidebar asks for one person's threads, newest first, on every page:
--   40,000 threads across 2,000 users — 5.02ms before, 0.19ms after.
--
-- The first benchmark could not see this one. It gave every thread to a single
-- user, so "find this user's threads" was "read the whole table" and no index
-- could help. Worth recording: a benchmark whose data has the wrong *shape*
-- reports that an index is useless just as confidently as one that measures
-- correctly.
CREATE INDEX "Thread_userId_createdAt_idx" ON "Thread"("userId", "createdAt" DESC);

-- Two further candidates were built, measured, and dropped rather than kept
-- on the theory that an index cannot hurt:
--
--   Vote(messageId)  — the leaderboard joins votes to messages by turnId, not
--                      by messageId; the column is only read back in
--                      application code. No plan changed.
--   Message(status, model) INCLUDE (metrics)
--                    — 86% of messages are SUCCESS, so Postgres correctly
--                      prefers a sequential scan and ignored it entirely.
--
-- Both would have cost write time and storage to change nothing.
