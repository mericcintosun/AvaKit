/**
 * Runs a fixed sequence of CLI commands one after another and streams their
 * output line by line. The devnet and Fuji actions share it, so both get the
 * same guarantees: every command is spawned from an argument ARRAY (never a
 * shell string), `onDone` fires exactly once, and no line is emitted after it.
 * Every run and every command it spawns is registered (processes.ts), so that
 * stopping Studio stops them too.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import { StringDecoder } from "node:string_decoder";
import {
  KILL_GRACE_MS,
  type ProcessRegistry,
  signalCommand,
  studioProcesses,
} from "./processes.js";

export interface Step {
  cmd: string;
  args: string[];
  /**
   * A line printed just before the command, for something the log would
   * otherwise leave out — e.g. that an existing L1 config is being reused, so
   * no `blockchain create` appears.
   */
  note?: string;
  /**
   * Matches the command's final error line when it failed only because the
   * state it was asked for is already there (the blockchain is already
   * deployed, the network is already running). Such a failure is benign and the
   * sequence continues. It is tested against that one line only, so an
   * informational "already …" line earlier in the output never counts.
   */
  alreadyDone?: RegExp;
}

export interface RunHandle {
  /** Stop the running command. `onDone` still fires, once it has exited. */
  cancel: () => void;
}

/** A line with no newline yet is shown after this long without more output. */
export const PARTIAL_LINE_MS = 250;

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips ANSI escape sequences
const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Splits a byte stream into trimmed, non-empty lines with ANSI colours removed.
 * A carriage return (a redrawn progress line) ends a line too. A line cut in
 * half by a chunk boundary is held back until the rest arrives, so callers
 * always see whole lines.
 */
export function lineSplitter(onLine: (line: string) => void): {
  push: (chunk: Buffer) => void;
  end: () => void;
} {
  const decoder = new StringDecoder("utf8");
  let carry = "";
  let idle: ReturnType<typeof setTimeout> | undefined;

  const emit = (raw: string): void => {
    const line = raw.replace(ANSI, "").trim();
    if (line) onLine(line);
  };
  const flush = (): void => {
    clearTimeout(idle);
    const rest = carry;
    carry = "";
    if (rest) emit(rest);
  };

  return {
    push(chunk) {
      clearTimeout(idle);
      const parts = (carry + decoder.write(chunk)).split(/\r\n|\r|\n/);
      carry = parts.pop() ?? "";
      for (const part of parts) emit(part);
      if (carry) {
        idle = setTimeout(flush, PARTIAL_LINE_MS);
        idle.unref();
      }
    },
    end() {
      carry += decoder.end();
      flush();
    },
  };
}

/** The shell convention for a process ended by a signal: 128 + signal number. */
function signalExitCode(signal: NodeJS.Signals | null): number {
  const n = signal ? constants.signals[signal] : undefined;
  return n ? 128 + n : 1;
}

/**
 * Told the pid of each command as soon as it is spawned, and null once it has
 * exited. The action lock records it: a Studio that is killed outright (no
 * chance to stop its command) leaves the command running, and no other action
 * may start until it has ended (see lock.ts).
 */
export type OnCommand = (pid: number | null) => void;

/** The line a run ends with when Studio stops before its next command. */
export const STOPPING_LINE = "■ cancelled — Studio is stopping";

/**
 * Run `steps` in order, streaming each output line. Stops at the first step
 * that fails. Returns a handle that cancels the command in flight.
 */
export function runSteps(
  steps: Step[],
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
  onCommand?: OnCommand,
  registry: ProcessRegistry = studioProcesses,
): RunHandle {
  let current: ChildProcess | null = null;
  let cancelled = false;
  let finished = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let unregister: () => void = () => {};

  const emit = (line: string): void => {
    if (!finished) onLine(line);
  };
  const finish = (exitCode: number): void => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    current = null;
    unregister();
    onDone(exitCode);
  };

  const runStep = (i: number): void => {
    const step = steps[i];
    if (!step) {
      finish(0);
      return;
    }
    // Studio is stopping (shutdown.ts): nothing new starts.
    if (registry.isStopping()) {
      emit(STOPPING_LINE);
      finish(signalExitCode("SIGTERM"));
      return;
    }
    if (step.note) emit(step.note);
    const commandLine = `${step.cmd} ${step.args.join(" ")}`;
    emit(`$ ${commandLine}`);

    let child: ChildProcess;
    try {
      // `detached` puts the CLI in its own process group, so the Ctrl+C that
      // the terminal sends to Studio's group never reaches it half-way: Studio
      // stops it itself (shutdown.ts), the way Cancel does, and waits for it.
      // Only a Studio killed outright leaves it running (see lock.ts).
      child = spawn(step.cmd, step.args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      emit(`error: ${e instanceof Error ? e.message : String(e)}`);
      finish(1);
      return;
    }
    current = child;
    registry.trackCommand(child, commandLine, { owned: true, group: true });
    // At once, in the same tick as the spawn: nothing (a signal handler
    // included) can run in between and miss the command.
    if (child.pid !== undefined) onCommand?.(child.pid);

    // A failed spawn emits `error` and then `close`; this step reports once.
    let settled = false;
    // The line that explains a failure: the last one starting with "Error"
    // (how avalanche-cli reports it), else simply the last line it printed.
    let lastLine = "";
    let lastError = "";
    const track = (line: string): void => {
      lastLine = line;
      if (/^error\b/i.test(line)) lastError = line;
      emit(line);
    };
    const stdout = lineSplitter(track);
    const stderr = lineSplitter(track);
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (e: NodeJS.ErrnoException) => {
      if (child.pid !== undefined) {
        // It did start (this is e.g. a failed signal) — report and wait for `close`.
        emit(`error: ${e.message}`);
        return;
      }
      if (settled) return;
      settled = true;
      emit(
        e.code === "ENOENT"
          ? `error: ${step.cmd} is not installed or not on your PATH`
          : `error: ${e.message}`,
      );
      finish(1);
    });

    child.on("close", (code, signal) => {
      stdout.end();
      stderr.end();
      if (child.pid !== undefined) onCommand?.(null);
      if (settled) return;
      settled = true;
      if (cancelled) {
        emit("■ cancelled");
        finish(code ?? signalExitCode(signal));
        return;
      }
      if (code === 0) {
        runStep(i + 1);
        return;
      }
      if (code !== null && step.alreadyDone?.test(lastError || lastLine)) {
        emit("↳ already in place — continuing");
        runStep(i + 1);
        return;
      }
      emit(code === null ? `✖ killed by ${signal ?? "a signal"}` : `✖ exited with code ${code}`);
      finish(code ?? signalExitCode(signal));
    });
  };

  // Stopping a command signals its whole process group: the command, and what
  // it started that is still in that group (as Ctrl+C on it in a terminal would).
  const cancel = (): void => {
    if (finished || cancelled) return;
    cancelled = true;
    const child = current;
    if (!child) {
      finish(signalExitCode("SIGTERM"));
      return;
    }
    signalCommand(child, "SIGTERM", true);
    killTimer = setTimeout(() => signalCommand(child, "SIGKILL", true), KILL_GRACE_MS);
    killTimer.unref();
  };
  const signal = (sig: NodeJS.Signals): void => {
    if (current) signalCommand(current, sig, true);
  };

  unregister = registry.registerAction({ cancel, signal });
  runStep(0);
  return { cancel };
}
