/**
 * Test helper: a directory of fake executables (`npm`, `pnpm`, …) that record
 * how they were called and exit however the test wants. Pointing a child's PATH
 * at it lets the CLI's real spawn code run end to end, with no network and no
 * dependence on what is installed on the machine.
 *
 * The fakes take their behaviour from the environment rather than from their
 * own text, so one set serves a whole test file: create it in `beforeAll`.
 * (macOS vets every new executable on first run, which makes a fresh set per
 * test slow enough to time out on a busy machine.)
 *
 * POSIX only (the fakes are `/bin/sh` scripts) — guard with `canFakeBin`.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const canFakeBin = process.platform !== "win32";

/** Generous: starting a process can take seconds on a loaded CI or macOS box. */
export const FAKE_BIN_TIMEOUT_MS = 30_000;

export interface FakeBehaviour {
  /** Exit status of whichever fake runs. Default 0. */
  exit?: number;
  /** A line for it to print on stdout. */
  stdout?: string;
  /** A line for it to print on stderr. */
  stderr?: string;
}

export interface FakeBin {
  /** One entry per invocation since the last `reset`: `<tool> <args…> @ <cwd>`. */
  calls(): string[];
  /** Forget the recorded invocations. */
  reset(): void;
  /** An environment in which only the fakes are on PATH, behaving as given. */
  env(behaviour?: FakeBehaviour, extra?: Record<string, string>): NodeJS.ProcessEnv;
  /** An environment in which nothing is on PATH, as on a machine without the tool. */
  emptyEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;
  cleanup(): void;
}

export function fakeBin(names: readonly string[]): FakeBin {
  const root = mkdtempSync(path.join(tmpdir(), "caa-fake-bin-"));
  const dir = path.join(root, "bin");
  const empty = path.join(root, "empty");
  const log = path.join(root, "calls.log");
  mkdirSync(dir);
  mkdirSync(empty);
  for (const name of names) {
    if (!/^[a-z]+$/.test(name)) throw new Error(`fakeBin: unsupported tool name "${name}"`);
    const script = [
      "#!/bin/sh",
      `printf '%s %s @ %s\\n' '${name}' "$*" "$PWD" >> "$FAKE_BIN_LOG"`,
      `if [ -n "$FAKE_BIN_STDOUT" ]; then printf '%s\\n' "$FAKE_BIN_STDOUT"; fi`,
      `if [ -n "$FAKE_BIN_STDERR" ]; then printf '%s\\n' "$FAKE_BIN_STDERR" >&2; fi`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template.
      'exit "${FAKE_BIN_EXIT:-0}"',
      "",
    ].join("\n");
    const file = path.join(dir, name);
    writeFileSync(file, script);
    chmodSync(file, 0o755);
  }
  return {
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [],
    reset: () => rmSync(log, { force: true }),
    env: (behaviour = {}, extra = {}) => ({
      PATH: dir,
      FAKE_BIN_LOG: log,
      FAKE_BIN_EXIT: String(behaviour.exit ?? 0),
      FAKE_BIN_STDOUT: behaviour.stdout ?? "",
      FAKE_BIN_STDERR: behaviour.stderr ?? "",
      ...extra,
    }),
    emptyEnv: (extra = {}) => ({ PATH: empty, ...extra }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
