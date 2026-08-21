-- Data fix, not a schema change (docs/scope-v2.md Feature 1, live check).
--
-- tokensPerSecond was being computed over the streaming window alone. A model
-- that spends its budget on reasoning tokens produces them during the wait for
-- the first visible token, so that denominator stored 3152 tok/s against 49
-- characters of text. The definition is now outputTokens over the whole
-- window, and the rows already written under the old one are corrected here
-- rather than left to skew a leaderboard that averages them.

-- Exactly recomputable: these rows stored every term of the new formula.
UPDATE "Message"
SET "tokensPerSecond" =
  "outputTokens"::float8 / (("timeToFirstTokenMs" + "generationDurationMs")::float8 / 1000)
WHERE "generationDurationMs" IS NOT NULL
  AND "timeToFirstTokenMs" IS NOT NULL
  AND "outputTokens" IS NOT NULL
  AND ("timeToFirstTokenMs" + "generationDurationMs") > 0;

-- Not recomputable: written before generationDurationMs existed, so the window
-- they were measured over is gone. Cleared rather than kept, because the
-- leaderboard takes an average and cannot tell the two definitions apart — a
-- row with no measurement is simply not counted, while a row carrying a number
-- from the old definition quietly bends the result. Wins and losses are
-- untouched; only the speed figure is dropped.
UPDATE "Message" SET "tokensPerSecond" = NULL WHERE "generationDurationMs" IS NULL;
