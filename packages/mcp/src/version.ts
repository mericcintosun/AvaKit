import { readFileSync } from "node:fs";

/**
 * The package version, read from package.json at run time: the single source
 * of truth, so it can never drift from what was published. `dist/index.js`
 * ships next to package.json, as `src/` sits next to it here, so
 * `../package.json` resolves in both.
 */
export const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
