import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "@modelcontextprotocol/sdk",
    "@avakit/core",
    "create-avalanche-app",
    "create-avalanche-app/api",
    "viem",
    "zod",
  ],
});
