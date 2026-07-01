import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  // Don't wipe dist — the Vite UI build shares dist/web. The `build` script
  // does a single `rm -rf dist` up front instead.
  clean: false,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: ["@avakit/core"],
});
