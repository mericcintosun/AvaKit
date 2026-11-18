import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliContext } from "./cli.js";

/**
 * The bin entry, run for real: each test imports `index.ts` afresh under a
 * Node.js version it pretends to be on, with `cli.ts` replaced by a stand-in
 * that records whether it was loaded at all and what `run()` was handed.
 */

const realNode = Object.getOwnPropertyDescriptor(process.versions, "node");
const realExitCode = process.exitCode;

/** Make `process.versions.node` report `version` until the test ends. */
function pretendNode(version: string): void {
  Object.defineProperty(process.versions, "node", { ...realNode, value: version });
}

let stderr: string;
/** How many times the CLI module was loaded. */
let loads: number;
const run = vi.fn<(ctx: CliContext) => Promise<number>>();
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderr = "";
  loads = 0;
  run.mockReset();
  run.mockResolvedValue(0);
  vi.resetModules();
  vi.doMock("./cli.js", () => {
    loads++;
    return { run };
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  if (realNode) Object.defineProperty(process.versions, "node", realNode);
  // The entry sets it on a refusal; left behind, it would fail the whole test run.
  process.exitCode = realExitCode;
  vi.doUnmock("./cli.js");
  vi.restoreAllMocks();
});

/** Run the entry as `node dist/index.js` would, on the given Node.js version. */
async function start(nodeVersion: string): Promise<void> {
  pretendNode(nodeVersion);
  await import("./index.js");
  // `run()` is not awaited by the entry; let its `.then()` settle.
  await new Promise((resolve) => setImmediate(resolve));
}

describe("the create-avalanche-app entry", () => {
  it("refuses a Node.js below the engines floor with one line, before loading the CLI", async () => {
    // Node.js 20 and 21 included: the wizard's UI library declares Node.js 22.
    for (const version of ["18.19.1", "20.11.0", "20.20.2", "21.7.3"]) {
      stderr = "";
      vi.resetModules();
      await start(version);

      expect(stderr, version).toBe(
        `Error: create-avalanche-app needs Node.js 22 or newer, but this is Node.js ${version}. ` +
          "Install Node.js 22 or 24 from https://nodejs.org and run the command again.\n",
      );
      expect(process.exitCode, version).toBe(1);
    }
    // Not even imported, so nothing is asked and nothing is created.
    expect(loads).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("says nothing on a tested Node.js and hands the process to the CLI", async () => {
    for (const version of ["22.0.0", "24.1.0"]) {
      vi.resetModules();
      await start(version);
    }

    expect(stderr).toBe("");
    expect(run).toHaveBeenCalledTimes(2);
    const ctx = run.mock.calls[0]?.[0];
    expect(ctx?.argv).toEqual(process.argv.slice(2));
    expect(ctx?.cwd).toBe(process.cwd());
    expect(ctx?.env).toBe(process.env);
    expect(ctx?.platform).toBe(process.platform);
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits with the status the CLI returns", async () => {
    run.mockResolvedValue(1);
    await start("24.1.0");

    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("what loads before the Node.js check", () => {
  /** The modules a source file imports statically, which load before any of its code runs. */
  function staticImports(file: string): string[] {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    return [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map(
      (match) => match[1] ?? "",
    );
  }

  it("is the check itself and Node.js built-ins, nothing an old Node.js could fail to load", () => {
    // A static import in either file runs before the check: one that needs a
    // newer Node.js (the CLI, Ink, React) would turn the one-line refusal back
    // into a stack trace. The CLI is loaded with `await import()`, after it.
    expect(staticImports("./index.ts")).toEqual(["./preflight.js"]);
    const preflight = staticImports("./preflight.ts");
    expect(preflight.length).toBeGreaterThan(0);
    for (const specifier of preflight) expect(specifier).toMatch(/^node:/);
  });
});
