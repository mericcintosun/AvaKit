import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The CLI reports anonymous usage and keeps a small config file under the user's
// home. A test run must do neither, whatever an individual test remembers to
// stub: telemetry is off for the whole suite, and the config directory points
// away from the real one. Tests that exercise telemetry itself opt back in
// explicitly, with their own directory and a local endpoint.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    env: {
      AVAKIT_TELEMETRY_DISABLED: "1",
      AVAKIT_CONFIG_DIR: fileURLToPath(
        new URL("./node_modules/.cache/avakit-test-config", import.meta.url),
      ),
    },
  },
});
