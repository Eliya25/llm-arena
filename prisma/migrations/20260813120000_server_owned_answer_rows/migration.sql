-- Feature 1 (docs/scope-v2.md): the route owns the answer row.

-- The three lanes of one prompt all reach /api/chat at once and each is
-- willing to create the thread. This is what makes them converge on one.
ALTER TABLE "Thread" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "Thread_clientKey_key" ON "Thread"("clientKey");

-- One model answers one turn once. Turns the lookup from "search and hope"
-- into a constraint the database enforces, and makes a retry a rewrite.
CREATE UNIQUE INDEX "Message_turnId_model_key" ON "Message"("turnId", "model");

-- Pinned metric definitions. Renamed rather than dropped and re-added:
-- totalTokens always held completion tokens, so the existing measurements are
-- real outputTokens values and are kept.
ALTER TABLE "Message" RENAME COLUMN "totalTokens" TO "outputTokens";
ALTER TABLE "Message" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "Message" ADD COLUMN "generationDurationMs" INTEGER;

-- "In flight" stops being indistinguishable from "never started".
ALTER TYPE "MessageStatus" ADD VALUE 'STREAMING';
