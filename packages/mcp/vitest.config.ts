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
        // The files that decide what a tool call may do with the wallet this
        // server signs with have numbers of their own, on top of the package's,
        // so a drop there cannot hide behind the rest of the suite. Same rule:
        // measured, rounded down, minus a point (2026-11-21).
        //
        // src/guards.ts bounds tool inputs and refuses a mainnet transaction
        // without both `confirm: true` and AVAKIT_ALLOW_MAINNET=1
        // (97.61 / 97.05 / 100 / 100).
        "src/guards.ts": { statements: 96, branches: 96, functions: 99, lines: 99 },
        // src/limits.ts limits the contracts write_contract may call and the
        // AVAX one call may send: the floor of grant deliverable D1
        // (100 / 100 / 100 / 100).
        "src/limits.ts": { statements: 99, branches: 99, functions: 99, lines: 99 },
        // The policy engine D1 builds on that floor (limits per day, the
        // functions a contract may be called with, a person's confirmation)
        // starts high as well: put it under src/policy/ and these apply to it.
        "src/policy/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
});
