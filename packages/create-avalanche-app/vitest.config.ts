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
  },
});
