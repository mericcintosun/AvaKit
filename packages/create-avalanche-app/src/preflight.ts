/**
 * The Node.js check create-avalanche-app makes before it does anything else.
 *
 * A stranger's machine does not run the Node.js this was built on: Ubuntu
 * 24.04's `apt install nodejs` still gives Node.js 18, where the scaffolder
 * used to fail somewhere in the middle with a stack trace about a dependency.
 * So the entry (`index.ts`) asks here first: below the floor in this package's
 * `engines.node` it gets back one line to print and does not run; otherwise it
 * gets nothing back.
 *
 * The floor is Node.js 22, the oldest release line AvaKit is tested on, and also
 * what the wizard's terminal UI (`ink`) and several of its dependencies declare.
 * Those are installed fresh, within their semver ranges, on every
 * `npm create`, so a release of one of them may use what only Node.js 22 has
 * without notice: a Node.js below 22 is not something the CLI can promise to
 * run on, so it is refused rather than warned about.
 *
 * This module and the entry import nothing but Node built-ins and use no recent
 * syntax, so they still load on a Node.js that cannot load the rest of the CLI.
 * Keep it that way: an import added here runs before the check it would break.
 */

import { readFileSync } from "node:fs";

/** `[major, minor, patch]`. */
export type NodeVersion = readonly [number, number, number];

/** The Node.js release lines the whole flow is run on (.github/workflows/e2e-fuji.yml). */
export const TESTED_NODE_MAJORS = [22, 24, 26] as const;

/** The tested release lines as a person would list them: "22, 24 or 26". */
export function testedNodeLines(): string {
  const lines = TESTED_NODE_MAJORS.map(String);
  return lines.length > 1
    ? `${lines.slice(0, -1).join(", ")} or ${lines.at(-1)}`
    : (lines[0] ?? "");
}

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
 * uses is understood (`>=22`, with one to three numbers). Anything else is
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
  /** One line for stderr when not `ok`; null when `ok`. */
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
    // "22" rather than "22.0.0", "20.11" rather than "20.11.0": the floor the way
    // package.json states it, with trailing zeros left off.
    let shown = floor.length;
    while (shown > 1 && floor[shown - 1] === 0) shown--;
    const required = floor.slice(0, shown).join(".");
    return {
      ok: false,
      message:
        `Error: create-avalanche-app needs Node.js ${required} or newer, but this is ${running}. ` +
        `Install Node.js ${testedNodeLines()} from https://nodejs.org and run ` +
        "the command again.",
    };
  }
  return { ok: true, message: null };
}
