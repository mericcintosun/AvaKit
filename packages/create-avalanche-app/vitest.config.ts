import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The CLI reports anonymous usage to a public collector and keeps a small config
// file under the user's home. A test run must do neither, whatever an individual
// test remembers to stub, so the whole suite is fenced in three independent ways:
//
//   1. telemetry is switched off (AVAKIT_TELEMETRY_DISABLED);
//   2. the endpoint is a loopback address nothing listens on, so even a test that
//      switches telemetry back on cannot fall through to the real collector;
//   3. src/testing/no-network.ts refuses every HTTP(S) request that leaves this
//      machine and fails the test that made it.
//
// Tests that exercise telemetry itself opt back in explicitly, with their own
// config directory and their own server on 127.0.0.1.
//
// None of this applies when the tests are started without this file (from the
// repository root, say), so the tests that run the whole CLI do not lean on it:
// `run()` takes its telemetry settings from the environment it is handed, and
// cli.test.ts hands every run one with the first two fences in it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Several tests start real child processes or drive the terminal wizard key
    // by key; on a busy CI runner those can take seconds, not milliseconds.
    testTimeout: 20_000,
    setupFiles: ["./src/testing/no-network.ts"],
    env: {
      AVAKIT_TELEMETRY_DISABLED: "1",
      AVAKIT_TELEMETRY_URL: "http://127.0.0.1:9/e",
      AVAKIT_CONFIG_DIR: fileURLToPath(
        new URL("./node_modules/.cache/avakit-test-config", import.meta.url),
      ),
    },
    // `pnpm test` runs `vitest run --coverage`, so the thresholds below are part
    // of every test run, in CI and in the release job. They are a ratchet: each
    // sits about a point under what this suite measured when it was set
    // (2026-11-21: statements 92.39%, branches 86.26%, functions 93.87%,
    // lines 93.93%), so a change that drops tests, or adds code without them,
    // fails. When the numbers go up, raise the thresholds with them. Do not
    // lower them to land a change; add the tests instead.
    //
    // The whole suite is measured, so a partial run fails them: to run part of
    // it, call Vitest directly (`pnpm --filter create-avalanche-app exec vitest
    // run src/args.test.ts`). For a per-file table, add
    // `--coverage --coverage.reporter=text`.
    coverage: {
      provider: "v8",
      // Every source file counts, including one that no test imports yet.
      include: ["src/**/*.{ts,tsx}"],
      // Tests and test helpers are not shipped.
      exclude: ["src/**/*.test.{ts,tsx}", "src/testing/**"],
      reporter: ["text-summary"],
      thresholds: { statements: 91, branches: 85, functions: 92, lines: 92 },
    },
  },
});
