import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm test` runs `vitest run --coverage`, so the thresholds below are part
    // of every test run, in CI and in the release job. They are a ratchet: each
    // sits about a point under what this suite measured when it was set
    // (2026-11-21: statements 89.77%, branches 86.44%, functions 91.66%,
    // lines 91.06%), so a change that drops tests, or adds code without them,
    // fails. When the numbers go up, raise the thresholds with them. Do not
    // lower them to land a change; add the tests instead. (About half of what is
    // not covered is src/index.ts and src/banner.ts, which only run inside the
    // built server that dist.test.ts starts as a process, where nothing is
    // measured.)
    //
    // The whole suite is measured, so a partial run fails them: to run part of
    // it, call Vitest directly (`pnpm --filter @avakit/mcp exec vitest run
    // src/abi.test.ts`). For a per-file table, add
    // `--coverage --coverage.reporter=text`.
    coverage: {
      provider: "v8",
      // Every source file counts, including one that no test imports yet.
      include: ["src/**/*.ts"],
      // Tests and test helpers are not shipped.
      exclude: ["src/**/*.test.ts", "src/testing/**"],
      reporter: ["text-summary"],
      thresholds: {
        statements: 88,
        branches: 85,
        functions: 90,
        lines: 90,
        // The policy layer that will gate every write (spend caps, allowlists,
        // confirmation above a threshold: grant deliverable D1) decides what an
        // agent may spend, so it starts high and stays there. Put it under
        // src/policy/ and these apply to it on top of the package's numbers.
        "src/policy/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
});
