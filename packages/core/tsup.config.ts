import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/chains.ts", "src/web3auth.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["viem", "@web3auth/modal"],
});
