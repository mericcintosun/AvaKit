import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Single source of truth for the exported VERSION — injected from package.json
// at build time so it can never drift from the published version.
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  // `index` is the client entry: src/index.ts starts with "use client", and
  // esbuild carries an entry file's directive into its bundle. `utils` is the
  // server-safe entry ("@avakit/react/utils") with the pure helpers and no
  // directive; the code both share lands in a directive-free chunk.
  entry: { index: "src/index.ts", utils: "src/utils.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Keep this off. tsup's `treeshake` runs the output through Rollup, which
  // silently strips module-level directives, so "use client" would vanish from
  // the published entry. esbuild already drops unused code while bundling.
  treeshake: false,
  define: { __AVAKIT_VERSION__: JSON.stringify(version) },
  external: [
    "react",
    "react-dom",
    "@avakit/core",
    "viem",
    "@radix-ui/react-dialog",
    "class-variance-authority",
    "clsx",
    "lucide-react",
    "tailwind-merge",
  ],
});
