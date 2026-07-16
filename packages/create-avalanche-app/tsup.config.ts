import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Bake @avakit/core and @avakit/react's real versions into the bundle, so the
// scaffolder pins each scaffolded app to exactly what shipped without anyone
// hand-maintaining a version constant (see api.ts). Read from the sibling
// package.jsons — the published dist never needs them again.
const version = (pkg: string): string =>
  (
    JSON.parse(readFileSync(new URL(`../${pkg}/package.json`, import.meta.url), "utf8")) as {
      version: string;
    }
  ).version;

export default defineConfig({
  entry: ["src/index.ts", "src/api.ts"],
  format: ["esm"],
  dts: { entry: ["src/api.ts"] },
  clean: true,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __AVAKIT_CORE_VERSION__: JSON.stringify(version("core")),
    __AVAKIT_REACT_VERSION__: JSON.stringify(version("react")),
  },
  // Keep the interactive UI stack (Ink + React) external — it installs alongside
  // the bin, so the published bundle stays small.
  external: ["picocolors", "ink", "react", "react/jsx-runtime", "@inkjs/ui"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
