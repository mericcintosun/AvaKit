import { defineConfig } from "vitest/config";

// The Studio backend (src/*) is Node code; its unit tests run in a node
// environment. The UI (ui/*) is built separately with Vite and has no unit
// tests, so scope Vitest to the backend to keep a plain `vitest run` green.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
