-- A retry reuses the (turnId, model) row instead of adding a second answer for
-- the same model. Without a way to tell the tries apart, a previous attempt
-- whose recorder is still reading — which after() deliberately keeps alive —
-- would go on writing checkpoints and a terminal result over the attempt that
-- replaced it. Every recorder write now names its attempt, so a stale writer
-- updates zero rows and stops.
ALTER TABLE "Message" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;
