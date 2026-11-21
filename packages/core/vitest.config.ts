import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm test` runs `vitest run --coverage`, so the thresholds below are part
    // of every test run, in CI and in the release job. They are a ratchet: each
    // sits about a point under what this suite measured when it was set
    // (2026-11-21: statements 94.05%, branches 85.93%, functions 96.29%,
    // lines 94.19%), so a change that drops tests, or adds code without them,
    // fails. When the numbers go up, raise the thresholds with them. Do not
    // lower them to land a change; add the tests instead.
    //
    // The whole suite is measured, so a partial run fails them: to run part of
    // it, call Vitest directly (`pnpm --filter @avakit/core exec vitest run
    // src/chains.test.ts`). For a per-file table, add
    // `--coverage --coverage.reporter=text`.
    coverage: {
      provider: "v8",
      // Every source file counts, including one that no test imports yet.
      include: ["src/**/*.ts"],
      // Tests and test helpers are not shipped.
      exclude: ["src/**/*.test.ts", "src/testing/**"],
      reporter: ["text-summary"],
      thresholds: { statements: 93, branches: 84, functions: 95, lines: 93 },
    },
  },
});
