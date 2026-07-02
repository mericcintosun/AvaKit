import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Single source of truth for the exported VERSION — injected from package.json
// at build time so it can never drift from the published version.
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
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
