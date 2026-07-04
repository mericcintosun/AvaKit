import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/api.ts"],
  format: ["esm"],
  dts: { entry: ["src/api.ts"] },
  clean: true,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  // Keep the interactive UI stack (Ink + React) external — it installs alongside
  // the bin, so the published bundle stays small.
  external: ["picocolors", "ink", "react", "react/jsx-runtime", "@inkjs/ui"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
