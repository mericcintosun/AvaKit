/**
 * The Node.js check create-avalanche-app makes before it does anything else.
 *
 * A stranger's machine does not run the Node.js this was built on: Ubuntu
 * 24.04's `apt install nodejs` still gives Node.js 18, where the scaffolder
 * used to fail somewhere in the middle with a stack trace about a dependency.
 * So the entry (`index.ts`) asks here first, and gets back one line to print:
 *
 *   - below the floor in this package's `engines.node`: an error, and no run;
 *   - on a release line older than the ones AvaKit is tested on: a warning, and
 *     the run goes ahead;
 *   - otherwise nothing.
 *
 * This module and the entry import nothing but Node built-ins and use no recent
 * syntax, so they still load on a Node.js that cannot load the rest of the CLI.
 * Keep it that way: an import added here runs before the check it would break.
 */

import { readFileSync } from "node:fs";

/** `[major, minor, patch]`. */
export type NodeVersion = readonly [number, number, number];

/** The Node.js release lines the whole flow is run on (.github/workflows/e2e-fuji.yml). */
export const TESTED_NODE_MAJORS = [22, 24] as const;

/**
 * `engines.node` from this package's own package.json: the one place the floor
 * is written down, so the check can never disagree with what npm is told.
 * Undefined if it cannot be read, in which case no floor is enforced.
 */
export const ENGINES_NODE: string | undefined = readEnginesNode();

function readEnginesNode(): string | undefined {
  try {
    // dist/index.js and src/preflight.ts both sit one level below package.json.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      engines?: { node?: unknown };
    };
    const range = pkg.engines?.node;
    return typeof range === "string" ? range : undefined;
  } catch {
    return undefined;
  }
}

/** `"v20.11.0"`, `"20.11.0"` or `"24.0.0-nightly…"` as numbers; null for anything else. */
export function parseNodeVersion(version: string): NodeVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareNodeVersions(a: NodeVersion, b: NodeVersion): number {
  // Number by number: compared as text, "20.9.0" would come after "20.11.0".
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The oldest version an `engines.node` range allows. Only the form this package
 * uses is understood (`>=20.11`, with one to three numbers). Anything else is
 * null, and no floor is enforced, rather than guessed at: a range such as
 * `^20.11 || >=22` has no single floor to compare against.
 */
export function nodeFloor(range: string | undefined): NodeVersion | null {
  const match = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export interface NodeCheck {
  /** False when this Node.js is too old to run the CLI at all. */
  ok: boolean;
  /** One line for stderr: the error when not `ok`, a warning or nothing when `ok`. */
  message: string | null;
}

/**
 * @param found The running Node.js version (`process.versions.node`).
 * @param enginesNode The supported range; defaults to this package's `engines.node`.
 */
export function checkNodeVersion(
  found: string,
  enginesNode: string | undefined = ENGINES_NODE,
): NodeCheck {
  const version = parseNodeVersion(found);
  // A version that cannot be read cannot be shown to be too old.
  if (!version) return { ok: true, message: null };
  const running = `Node.js ${found.trim().replace(/^v/, "")}`;

  const floor = nodeFloor(enginesNode);
  if (floor && compareNodeVersions(version, floor) < 0) {
    // "20.11" rather than "20.11.0": the floor the way package.json states it.
    const required = floor[2] === 0 ? `${floor[0]}.${floor[1]}` : floor.join(".");
    return {
      ok: false,
      message:
        `Error: create-avalanche-app needs Node.js ${required} or newer, but this is ${running}. ` +
        `Install Node.js ${TESTED_NODE_MAJORS.join(" or ")} from https://nodejs.org and run ` +
        "the command again.",
    };
  }
  if (version[0] < TESTED_NODE_MAJORS[0]) {
    return {
      ok: true,
      message:
        `Warning: this is ${running}. Node.js 20 reached end-of-life in April 2026, and AvaKit ` +
        `is tested on Node.js ${TESTED_NODE_MAJORS.join(" and ")}. Upgrade when you can: ` +
        "https://nodejs.org",
    };
  }
  return { ok: true, message: null };
}
