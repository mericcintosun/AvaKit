import { configDefaults, defineConfig } from "vitest/config";

// Everything runs in a node environment. The backend tests (src/*) are fully
// sandboxed: a fake HOME and a PATH holding only stub executables, so they
// never reach the real avalanche-cli, cast or ~/.avalanche-cli (see
// src/testing/sandbox.ts). The UI tests (ui/src/lib/*) cover the dashboard's
// framework-free logic — the run store and the reducers behind the views —
// which needs no DOM; the React components themselves are built with Vite and
// have no unit tests.

// The stubs are POSIX shell launchers, so the suites that use the sandbox are
// left out on Windows (the pure ones still run there).
const SANDBOXED = [
  "src/devnet.test.ts",
  "src/fuji.test.ts",
  "src/icm.test.ts",
  "src/mcp.test.ts",
  "src/server.test.ts",
  "src/steps.test.ts",
];

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "ui/src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...(process.platform === "win32" ? SANDBOXED : [])],
    environment: "node",
    // One process per test file: the sandbox swaps HOME and PATH, and
    // os.homedir() only follows HOME for a whole process (not a worker thread).
    pool: "forks",
    // The backend tests start real (stub) processes. On a busy machine or a
    // small CI runner, starting one can take most of a second, and a test may
    // start several — the 5 s default is too tight for that.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
