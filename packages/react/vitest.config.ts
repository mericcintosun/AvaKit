import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Above the five seconds a waitFor may now take (see src/test-setup.ts), so a
    // condition that never holds fails with waitFor's message, not a bare timeout.
    testTimeout: 15_000,
  },
});
