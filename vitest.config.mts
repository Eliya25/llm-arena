import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The alias is declared here rather than pulled from tsconfig by a plugin, so
// the test setup carries no dependency the app itself doesn't already have.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // Streaming and supersession tests wait on real intervals against a real
    // database, so they need longer than the default.
    testTimeout: 30_000,
  },
});
