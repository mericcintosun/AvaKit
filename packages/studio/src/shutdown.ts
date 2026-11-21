/**
 * How Studio ends: the dashboard on Ctrl+C, SIGTERM or a closed terminal
 * (SIGHUP), and the MCP server on SIGTERM or when its client closes stdin —
 * which is how an MCP client ends a stdio server. In that order:
 *
 *  1. It stops taking work: the HTTP server or the MCP connection is closed.
 *  2. It stops everything it started (processes.ts). The avalanche-cli command
 *     in flight gets SIGTERM, as from the Cancel button, then SIGKILL after 5 s,
 *     and Studio waits for it to exit, so the action lock is given back. A
 *     second Ctrl+C kills it at once.
 *  3. It says what it stopped, and what keeps running: the local Avalanche
 *     network stays up on purpose. It belongs to avalanche-cli, not to Studio,
 *     and your apps, a terminal or another Studio may be using it. Studio says
 *     so and how to stop it (`avalanche network stop`) instead.
 *  4. It exits: 130 after SIGINT, 143 after SIGTERM, 129 after SIGHUP, and 0
 *     when the MCP client closed the connection.
 *
 * Only a Studio that is killed outright (SIGKILL, a crash) leaves a command
 * running. The action lock then stays held for that command (lock.ts).
 *
 * Nobody may be reading any more by the time Studio stops: a closed terminal
 * window, or an agent's client that was killed, takes its end of stdout and
 * stderr with it. Each write then fails (EIO on a closed terminal, EPIPE on a
 * pipe), and what Studio says is lost, but the stop still runs to its end.
 */

import { type ProcessRegistry, type Running, studioProcesses } from "./processes.js";

/** Why Studio stops: a signal, or (MCP) its client closed the connection. */
export type StopReason = "SIGINT" | "SIGTERM" | "SIGHUP" | "disconnected";

const EXIT_CODES: Record<StopReason, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  disconnected: 0,
};

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** How long closing the server may take before Studio moves on. */
const CLOSE_TIMEOUT_MS = 2000;
/** How long the look at what keeps running may take. */
const NOTICE_TIMEOUT_MS = 2500;
/** After SIGKILL, how long the killed commands get to be reaped. */
const KILL_SETTLE_MS = 1000;

export interface ShutdownOptions {
  /** Where Studio tells the person what happens: stdout, or stderr for the MCP server. */
  write: (text: string) => void;
  /** Stop taking work: close the HTTP server or the MCP connection. */
  close?: () => Promise<void> | void;
  /** Lines about what keeps running after Studio has gone (the local network). */
  stillRunning?: () => Promise<string[]>;
  /** End the process. Defaults to flushing stdout and stderr, then process.exit. */
  exit?: (code: number) => void;
  /** The processes to stop. Defaults to this Studio's own. */
  registry?: ProcessRegistry;
  /** How long a command gets on SIGTERM before SIGKILL. */
  graceMs?: number;
}

export interface Shutdown {
  /**
   * Stop Studio for `reason`. Resolves once the process has been told to exit.
   * A signal while it is already stopping kills what is still running at once.
   */
  stop: (reason: StopReason) => Promise<void>;
}

/** A command as a line of the report: "avalanche network start (pid 4242)". */
function describe(r: Running): string {
  return `${r.label} (pid ${r.pid})`;
}

/** Resolves when `work` does, or after `ms`, whichever comes first. Never rejects. */
async function bounded<T>(work: () => Promise<T> | T, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Flush stdout and stderr (a pipe is asynchronous on macOS), then exit. */
function flushAndExit(code: number): void {
  let pending = 2;
  const done = () => {
    if (--pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
  // A stream that can no longer be written must not keep the process alive.
  setTimeout(() => process.exit(code), 1000).unref();
}

export function createShutdown(options: ShutdownOptions): Shutdown {
  const registry = options.registry ?? studioProcesses;
  const exit = options.exit ?? flushAndExit;
  const say = (lines: string[]) => {
    if (lines.length === 0) return;
    try {
      options.write(`${lines.join("\n")}\n`);
    } catch {
      // Nobody can read it any more. Saying it is a courtesy; stopping is the point.
    }
  };
  let reason: StopReason | null = null;
  let forced = false;
  let exited = false;
  const leave = (code: number) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  /** A second signal: kill what is still running now, and go. */
  async function force(code: number): Promise<void> {
    if (forced) return;
    forced = true;
    const killed = registry.signalAll("SIGKILL");
    say(killed.map((r) => `Killed ${describe(r)}.`));
    await registry.settled(KILL_SETTLE_MS);
    leave(code);
  }

  async function stop(why: StopReason): Promise<void> {
    if (reason !== null) {
      // Stopping already. Another signal means "now"; the connection closing
      // as well (an MCP client closes stdin, then signals) changes nothing.
      if (why !== "disconnected") await force(EXIT_CODES[reason]);
      return;
    }
    reason = why;
    const code = EXIT_CODES[why];

    const inFlight = registry.running();
    if (inFlight.length > 0) {
      say([
        "",
        `Stopping Studio and what it started${why === "SIGINT" ? " (Ctrl+C again kills it at once)" : ""}:`,
        ...inFlight.map((r) => `  ${describe(r)}`),
      ]);
    }
    await bounded(() => options.close?.(), CLOSE_TIMEOUT_MS, undefined);
    const report = await registry.stopAll(options.graceMs);
    if (forced) return;
    say(report.stopped.map((r) => `Stopped ${describe(r)}.`));
    say(
      report.left.map(
        (r) =>
          `Still running: ${describe(r)}. Studio could not stop it; end it with kill ${r.pid}.`,
      ),
    );
    say(await bounded(() => options.stillRunning?.() ?? [], NOTICE_TIMEOUT_MS, []));
    if (forced) return;
    leave(code);
  }

  return { stop };
}

/**
 * The 'error' of a write to stdout or stderr whose reader has gone (EPIPE, or EIO on a closed
 * terminal). Unheard, it would end the process on the spot, before the command
 * in flight is stopped and the action lock given back. Heard, only that write
 * and the ones after it are lost.
 */
function lostReader(): void {}

/**
 * Stop Studio the way the comment at the top says when the process is told to:
 * SIGINT, SIGTERM and SIGHUP. A stdout or stderr that nobody reads any more
 * does not stop it half-way. Whatever ends the process some other way (an
 * error nothing caught, process.exit) still sends SIGTERM to every command
 * Studio started, on its way out.
 */
export function installShutdown(options: ShutdownOptions): Shutdown & { uninstall: () => void } {
  const registry = options.registry ?? studioProcesses;
  const shutdown = createShutdown(options);
  const onSignal = (signal: NodeJS.Signals) => {
    void shutdown.stop(signal as StopReason);
  };
  const onExit = () => {
    registry.signalAll("SIGTERM");
  };
  // What Studio says goes to one of these.
  const outputs = [process.stdout, process.stderr];
  for (const stream of outputs) stream.on("error", lostReader);
  for (const signal of SIGNALS) process.on(signal, onSignal);
  process.on("exit", onExit);
  return {
    ...shutdown,
    uninstall() {
      for (const stream of outputs) stream.off("error", lostReader);
      for (const signal of SIGNALS) process.off(signal, onSignal);
      process.off("exit", onExit);
    },
  };
}
