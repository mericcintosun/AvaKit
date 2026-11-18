import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { bundleAuditPlugin } from "./scripts/bundle-audit.mjs";

const { name } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  name: string;
};

/**
 * The server is published as ONE file with its third-party code inside it.
 *
 * An MCP client gives a server a fixed time to connect (30 seconds in Claude
 * Code), and on an empty npm cache `npx -y @avakit/mcp` used to spend longer
 * than that downloading about 150 packages before a line of the server ran.
 * So everything the server imports is bundled, and the published package has a
 * single dependency:
 *
 *   • `create-avalanche-app` stays external. Its `/api` entry finds the
 *     templates next to its own file, so bundling it would need a second copy
 *     of the templates, and as a dependency a scaffolder release still bumps
 *     the server.
 *   • `@avakit/core`, the MCP SDK, viem and zod are devDependencies and end up
 *     in `dist/index.js`, with whatever they import.
 *
 * `bundleAuditPlugin` fails the build when the result is not self-contained or
 * carries a transport the server never uses, and writes the licence notices of
 * what was bundled to `dist/THIRD_PARTY_LICENSES.txt`.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  // A source map of the bundle would carry the full sources of every bundled
  // library into the package. The output is not minified, so a stack trace is
  // readable without one.
  sourcemap: false,
  // One file: the dynamic imports inside viem would otherwise become chunks.
  splitting: false,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: ["create-avalanche-app"],
  noExternal: ["@avakit/core", "@modelcontextprotocol/sdk", "viem", "zod"],
  esbuildPlugins: [bundleAuditPlugin({ self: name })],
});
