-- The generation lifecycle, enforced by the database rather than by every
-- writer remembering it (docs/scope-v2.md Feature 2).
--
-- The machine is scoped to an attempt, which is the part the scope originally
-- got wrong. It listed SUCCESS -> PENDING as forbidden, but that is exactly
-- what a retry does: claimAnswerRow blanks the row and increments `attempt` in
-- one statement. The real rule is that nothing moves backwards *without taking
-- ownership of a new attempt*.
--
--   same attempt      PENDING -> STREAMING -> SUCCESS | FAILED
--                     PENDING -> SUCCESS | FAILED     (a stream with no
--                                                      checkpoint in it)
--                     and a terminal state is terminal
--
--   new attempt       the only thing that may reset a row, and it must reset
--                     it to PENDING
--
-- A trigger rather than conditions in the application, so the rule binds every
-- writer: a future code path that forgets, a one-off script, Prisma Studio, or
-- someone at a psql prompt.

CREATE OR REPLACE FUNCTION enforce_message_transition() RETURNS trigger AS $$
BEGIN
  IF NEW."attempt" <> OLD."attempt" THEN
    IF NEW."attempt" < OLD."attempt" THEN
      RAISE EXCEPTION
        'message %: attempt may not go backwards (% -> %)',
        OLD."id", OLD."attempt", NEW."attempt";
    END IF;
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION
        'message %: a new attempt must start at PENDING, not %',
        OLD."id", NEW."status";
    END IF;
    RETURN NEW;
  END IF;

  -- Content checkpoints and metric backfills leave the status alone.
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('SUCCESS', 'FAILED') THEN
    RAISE EXCEPTION
      'message %: answer is already % and cannot become % without a new attempt',
      OLD."id", OLD."status", NEW."status";
  END IF;

  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION
      'message %: cannot go back to PENDING from % without a new attempt',
      OLD."id", OLD."status";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_transition_guard
  BEFORE UPDATE ON "Message"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_message_transition();
