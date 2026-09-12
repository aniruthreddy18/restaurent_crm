import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Business-rule tests share one Postgres database and truncate between
    // cases, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Vitest has no React Server Component graph, so the `server-only` guard
      // resolves to its client build and throws on import. Tests run on the
      // server by definition, so stub it out.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
