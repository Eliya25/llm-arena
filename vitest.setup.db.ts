import { afterAll } from "vitest";
import { config } from "dotenv";

// Loaded here rather than by the app: the suite needs real credentials, and
// lib/env.ts fails fast on a missing one, which is the behaviour we want kept.
config({ path: ".env.local" });

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. The database tests need their own Prisma " +
      "Postgres instance — see docs/scope-v2.md Feature 5. They deliberately " +
      "do not fall back to DATABASE_URL.",
  );
}

// The guard that matters. These tests create, rewrite and delete rows, and a
// stray fallback to the app's own database would do all of that to real
// threads. Refusing is the only safe answer.
if (testUrl === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL and DATABASE_URL are the same database. Refusing to " +
      "run destructive tests against the application's data.",
  );
}

// Everything under test reaches Postgres through lib/prisma, which reads this
// at import time. Setup files run before any test module is imported, so
// pointing it here is enough — no production code learns about testing.
process.env.DATABASE_URL = testUrl;

// Imported after the reassignment above, never before: lib/prisma builds its
// connection pool at import time, and an early import would build it against
// the wrong database.
const { prisma } = await import("@/lib/prisma");

// Hand the pool back at the end of every file. Without this each run leaves
// its connections open, and a few runs in a row exhaust what the instance
// allows — which looks like the tests themselves failing, in a heap, for no
// reason anyone would connect to connection counts.
afterAll(async () => {
  await prisma.$disconnect();
});
