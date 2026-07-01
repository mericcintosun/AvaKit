import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/api.ts"],
  format: ["esm"],
  dts: { entry: ["src/api.ts"] },
  clean: true,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: ["@clack/prompts", "picocolors"],
});
