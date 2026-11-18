/**
 * Package managers: which one to use, and how to run it.
 *
 * Every command the CLI starts goes through here, so each one is checked — a
 * manager that is missing, or an install that fails, is reported to the caller
 * instead of being swallowed.
 */

import { spawn, spawnSync } from "node:child_process";

/** The package managers the CLI can drive, in the order they are offered. */
export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** npm ships with Node, so it is the one manager that is always there. */
export const DEFAULT_PACKAGE_MANAGER: PackageManager = "npm";

export function isPackageManager(value: unknown): value is PackageManager {
  return typeof value === "string" && (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * The package manager the user launched us with, read from the
 * `npm_config_user_agent` each of them sets for the processes it starts
 * (`npm/11.6.0 node/v24.0.0 darwin arm64 …`, `pnpm/10.20.0 npm/? node/…`,
 * `yarn/1.22.22 npm/? node/…`, `bun/1.3.0 npm/? node/…`).
 *
 * Returns null when the variable is absent (the CLI was started with plain
 * `node`) or names a tool we cannot drive.
 */
export function detectPackageManager(userAgent: string | undefined): PackageManager | null {
  const name = userAgent?.trim().split(/\s+/)[0]?.split("/")[0];
  return isPackageManager(name) ? name : null;
}

export interface RunOptions {
  cwd: string;
  /** Environment for the child; defaults to this process's. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to this process's platform; a parameter so the Windows path is testable. */
  platform?: NodeJS.Platform;
}

/**
 * - `not-found`: the package manager is not installed (not on PATH).
 * - `not-started`: it exists but could not be started.
 * - `stopped`: it was killed by a signal.
 * - `exit-code`: it ran and exited non-zero.
 */
export type RunFailure = "not-found" | "not-started" | "stopped" | "exit-code";

export interface RunResult {
  ok: boolean;
  /** What went wrong; null when `ok`. */
  failure: RunFailure | null;
  /** Exit status; null when the command never started or was stopped by a signal. */
  status: number | null;
  /** The failure as a sentence fragment, e.g. `"pnpm" was not found on your PATH`. Empty when `ok`. */
  reason: string;
  /** The last lines the command printed, when its output was captured. */
  output: string;
}

/** Only ever plain words such as `install`, `run`, `dev` — see `spawnTarget`. */
const SAFE_ARG = /^[a-z0-9][a-z0-9:_-]*$/;

/**
 * How to start `<pm> <args>` on a platform.
 *
 * On Windows npm, pnpm and yarn are `.cmd` shims, and Node refuses to start a
 * `.cmd` without a shell — so there, and only there, the command goes through
 * one. That is safe because nothing a user typed can reach the shell: `pm` is
 * one of four known names and `args` are fixed words, both re-checked here. The
 * command is passed as a single string because Node deprecates (DEP0190) an
 * argument array combined with `shell: true`.
 */
export function spawnTarget(
  pm: PackageManager,
  args: readonly string[],
  platform: NodeJS.Platform,
): { command: string; args: string[]; shell: boolean } {
  if (!isPackageManager(pm)) {
    throw new Error(`Unknown package manager "${String(pm)}".`);
  }
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new Error(`Unsafe package manager argument "${arg}".`);
  }
  if (platform === "win32") {
    return { command: [pm, ...args].join(" "), args: [], shell: true };
  }
  return { command: pm, args: [...args], shell: false };
}

function describeExit(
  pm: PackageManager,
  args: readonly string[],
  error: Error | undefined,
  status: number | null,
  signal: NodeJS.Signals | null,
  output = "",
): RunResult {
  const label = `${pm} ${args.join(" ")}`;
  if (error) {
    const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ok: false,
      failure: notFound ? "not-found" : "not-started",
      status: null,
      reason: notFound
        ? `"${pm}" was not found on your PATH`
        : `"${label}" could not be started (${error.message})`,
      output,
    };
  }
  if (status === 0) return { ok: true, failure: null, status, reason: "", output };
  if (status === null) {
    return {
      ok: false,
      failure: "stopped",
      status,
      reason: `"${label}" was stopped by ${signal ?? "a signal"}`,
      output,
    };
  }
  return {
    ok: false,
    failure: "exit-code",
    status,
    reason: `"${label}" exited with code ${status}`,
    output,
  };
}

/**
 * Run `<pm> <args>` attached to the user's terminal and wait for it. For the
 * plain (non-interactive) path and for handing the terminal to the dev server.
 * Never throws: a command that cannot be started is a failed result.
 */
export function runPackageManager(
  pm: PackageManager,
  args: readonly string[],
  options: RunOptions,
  spawnImpl: typeof spawnSync = spawnSync,
): RunResult {
  try {
    const target = spawnTarget(pm, args, options.platform ?? process.platform);
    const result = spawnImpl(target.command, target.args, {
      cwd: options.cwd,
      env: options.env,
      shell: target.shell,
      stdio: "inherit",
    });
    return describeExit(pm, args, result.error, result.status, result.signal);
  } catch (error) {
    return describeExit(pm, args, error as Error, null, null);
  }
}

/** How much of a quiet command's output to keep for the failure message. */
const OUTPUT_TAIL_CHARS = 4096;
const OUTPUT_TAIL_LINES = 4;
const OUTPUT_LINE_CHARS = 200;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * The last few non-empty lines of a command's output, without colour codes and
 * with overlong lines cut short — enough to say what went wrong, never enough
 * to flood the screen.
 */
export function outputTail(raw: string): string {
  return raw
    .replace(ANSI, "")
    .split(/\r?\n|\r/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-OUTPUT_TAIL_LINES)
    .map((line) =>
      line.length > OUTPUT_LINE_CHARS ? `${line.slice(0, OUTPUT_LINE_CHARS - 1)}…` : line,
    )
    .join("\n");
}

/**
 * Run `<pm> <args>` quietly, without blocking the event loop — the wizard keeps
 * rendering its spinner while this runs. Output is captured rather than shown,
 * and its tail is returned so a failure can say why. Never rejects.
 */
export function runPackageManagerQuietly(
  pm: PackageManager,
  args: readonly string[],
  options: RunOptions,
  spawnImpl: typeof spawn = spawn,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let tail = "";
    const keep = (chunk: Buffer | string) => {
      tail = (tail + chunk.toString()).slice(-OUTPUT_TAIL_CHARS);
    };
    let settled = false;
    const settle = (
      error: Error | undefined,
      status: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (settled) return;
      settled = true;
      resolve(describeExit(pm, args, error, status, signal, outputTail(tail)));
    };
    try {
      const target = spawnTarget(pm, args, options.platform ?? process.platform);
      const child = spawnImpl(target.command, target.args, {
        cwd: options.cwd,
        env: options.env,
        shell: target.shell,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      // A missing binary surfaces as an "error" event (and no "close").
      child.on("error", (error) => settle(error, null, null));
      child.on("close", (status, signal) => settle(undefined, status, signal));
    } catch (error) {
      settle(error as Error, null, null);
    }
  });
}
