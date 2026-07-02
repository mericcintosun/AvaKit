import { readFileSync } from "node:fs";

/**
 * The package version — read from package.json at runtime so it can never drift
 * from the published version (single source of truth). This file is bundled into
 * both dist/index.js and dist/mcp.js, which sit next to package.json in the
 * published tarball, so `../package.json` resolves in every entry point.
 */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
