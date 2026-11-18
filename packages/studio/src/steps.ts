/**
 * Runs a fixed sequence of CLI commands one after another and streams their
 * output line by line. The devnet and Fuji actions share it, so both get the
 * same guarantees: every command is spawned from an argument ARRAY (never a
 * shell string), `onDone` fires exactly once, and no line is emitted after it.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import { StringDecoder } from "node:string_decoder";

export interface Step {
  cmd: string;
  args: string[];
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

/** How long a cancelled command gets to exit on SIGTERM before it is killed. */
const KILL_GRACE_MS = 5000;

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
 * Run `steps` in order, streaming each output line. Stops at the first step
 * that fails. Returns a handle that cancels the command in flight.
 */
export function runSteps(
  steps: Step[],
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
): RunHandle {
  let current: ChildProcess | null = null;
  let cancelled = false;
  let finished = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (line: string): void => {
    if (!finished) onLine(line);
  };
  const finish = (exitCode: number): void => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    current = null;
    onDone(exitCode);
  };

  const runStep = (i: number): void => {
    const step = steps[i];
    if (!step) {
      finish(0);
      return;
    }
    emit(`$ ${step.cmd} ${step.args.join(" ")}`);

    let child: ChildProcess;
    try {
      // `detached` puts the CLI in its own process group so the local network
      // (or the Fuji validator node) it boots survives even if Studio is
      // stopped or restarted.
      child = spawn(step.cmd, step.args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      emit(`error: ${e instanceof Error ? e.message : String(e)}`);
      finish(1);
      return;
    }
    current = child;

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

  runStep(0);

  return {
    cancel: () => {
      if (finished || cancelled) return;
      cancelled = true;
      const child = current;
      if (!child) {
        finish(signalExitCode("SIGTERM"));
        return;
      }
      child.kill();
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    },
  };
}
