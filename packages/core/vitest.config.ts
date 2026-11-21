import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // coinbase.test.ts loads the real Coinbase SDK to check how it fails outside
    // a browser. Loading it is CPU-bound work: 0.3 to 1.5 s in an ordinary run,
    // 4.5 s with every package's suite running at once beside four busy
    // processes, and 5.1 to 6.6 s, past Vitest's five-second default, when the
    // flaky-test hunt starved the CPU further (2026-11-21). The other packages
    // give their tests 15 to 30 seconds for the same reason; this takes twenty.
    testTimeout: 20_000,
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
