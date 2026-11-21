import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Above the five seconds a waitFor may now take (see src/test-setup.ts), so a
    // condition that never holds fails with waitFor's message, not a bare timeout.
    testTimeout: 15_000,
    // `pnpm test` runs `vitest run --coverage`, so the thresholds below are part
    // of every test run, in CI and in the release job. They are a ratchet: each
    // sits about a point under what this suite measured when it was set
    // (2026-11-21: statements 95.95%, branches 85.62%, functions 95.91%,
    // lines 97.07%), so a change that drops tests, or adds code without them,
    // fails. When the numbers go up, raise the thresholds with them. Do not
    // lower them to land a change; add the tests instead.
    //
    // The whole suite is measured, so a partial run fails them: to run part of
    // it, call Vitest directly (`pnpm --filter @avakit/react exec vitest run
    // src/hooks.test.tsx`). For a per-file table, add
    // `--coverage --coverage.reporter=text`.
    coverage: {
      provider: "v8",
      // Every source file counts, including one that no test imports yet.
      include: ["src/**/*.{ts,tsx}"],
      // Tests and their setup are not shipped.
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
      reporter: ["text-summary"],
      thresholds: { statements: 94, branches: 84, functions: 94, lines: 96 },
    },
  },
});
