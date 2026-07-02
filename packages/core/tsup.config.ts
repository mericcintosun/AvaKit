import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Single source of truth for the exported VERSION — injected from package.json
// at build time so it can never drift from the published version.
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts", "src/chains.ts", "src/web3auth.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["viem", "@web3auth/modal"],
  define: { __AVAKIT_VERSION__: JSON.stringify(version) },
});
