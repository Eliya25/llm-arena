import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two suites, kept apart on purpose.
//
// `unit` is pure logic: no database, no environment variables, no setup, and
// it finishes in a fraction of a second. Anything that needs more than that
// belongs in the other suite, and the split is what keeps it honest — a unit
// test cannot quietly start depending on a database without moving files.
//
// `database` exercises the parts whose whole point is real database behaviour:
// unique constraints, conditional updates, atomic increments. Mocking Prisma
// there would only prove the mock agrees with itself.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: ["**/*.db.test.ts", "node_modules/**", ".next/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "database",
          include: ["**/*.db.test.ts"],
          exclude: ["node_modules/**", ".next/**"],
          environment: "node",
          setupFiles: ["./vitest.setup.db.ts"],
          // Streams are timed against real intervals and a real network.
          testTimeout: 60_000,
          // Rows are shared state; parallel files would race each other's
          // sweeps and counts.
          fileParallelism: false,
        },
      },
    ],
  },
});
