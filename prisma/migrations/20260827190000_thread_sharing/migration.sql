-- Existing threads remain private because no ThreadShare rows are backfilled.
CREATE TABLE "ThreadShare" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ThreadShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreadShare_threadId_key" ON "ThreadShare"("threadId");
CREATE UNIQUE INDEX "ThreadShare_tokenHash_key" ON "ThreadShare"("tokenHash");

ALTER TABLE "Turn" DROP CONSTRAINT "Turn_threadId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_turnId_fkey";
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_messageId_fkey";
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_turnId_fkey";

ALTER TABLE "Turn" ADD CONSTRAINT "Turn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadShare" ADD CONSTRAINT "ThreadShare_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
