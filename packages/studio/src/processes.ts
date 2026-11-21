/**
 * Everything Studio has started that is still running, so that stopping Studio
 * stops it too (shutdown.ts) and nothing Studio started is left running behind
 * it. Two kinds:
 *
 *  - actions: an avalanche-cli command sequence (steps.ts). An action is
 *    stopped through its own cancel, which is what the dashboard's Cancel
 *    button does: the command in flight gets SIGTERM, then SIGKILL after
 *    KILL_GRACE_MS, and the action ends without starting its next command;
 *  - commands: every process Studio spawns, by pid, from the start of its
 *    command line: the commands of those actions, and the one-off ones around
 *    them (`avalanche --version`, `avalanche key create`).
 *
 * An action's command runs in a process group of its own (it is spawned
 * detached), and stopping it signals that whole group: the command, and
 * whatever it started that is still in its group, the way a Ctrl+C on that
 * command in a terminal would.
 *
 * Once stopping has begun nothing new starts: an action ends before its next
 * command, and a command spawned in a race is signalled at once.
 *
 * What an avalanche-cli command leaves running once it has finished — the
 * nodes of the local network, a Fuji L1's validator — is not Studio's to stop:
 * the local network is stopped with `avalanche network stop`, never by Studio
 * exiting (see shutdown.ts).
 */

import type { ChildProcess } from "node:child_process";

/** How long a command gets to exit on SIGTERM before it is killed (SIGKILL). */
export const KILL_GRACE_MS = 5000;

/** A process Studio started that is still running. */
export interface Running {
  pid: number;
  /** Its command line, e.g. "avalanche network start". Never a secret: no secret is ever an argument. */
  label: string;
}

/** An action in flight, as runSteps registers it. */
export interface TrackedAction {
  /** Stop it: signal the command in flight (see runSteps). A second call changes nothing. */
  cancel: () => void;
  /** Send `signal` to the command in flight and its process group, at once. */
  signal: (signal: NodeJS.Signals) => void;
}

export interface StopReport {
  /** Everything that was running when stopping began, and has exited since. */
  stopped: Running[];
  /** Still running when Studio stopped waiting. */
  left: Running[];
}

export interface ProcessRegistry {
  /** True once stopping has begun: nothing new may start. */
  isStopping: () => boolean;
  /** Register an action in flight. Call the function it returns when the action has ended. */
  registerAction: (action: TrackedAction) => () => void;
  /**
   * Track a process that was just spawned, until it exits. `owned` is set for
   * the commands of an action, which their action stops itself; `group` for a
   * process spawned detached, whose whole process group is signalled.
   */
  trackCommand: (
    child: ChildProcess,
    label: string,
    options?: { owned?: boolean; group?: boolean },
  ) => void;
  /** The commands still running, oldest first. */
  running: () => Running[];
  /**
   * Stop everything: cancel every action, send SIGTERM to every other command,
   * SIGKILL to whatever is left after `graceMs`, and resolve once all of them
   * have exited — or `settleMs` after that, with what is left.
   */
  stopAll: (graceMs?: number, settleMs?: number) => Promise<StopReport>;
  /**
   * Send `signal` to every command still running, at once and synchronously
   * (a second Ctrl+C, the process's last moments). Returns what was signalled.
   */
  signalAll: (signal: NodeJS.Signals) => Running[];
  /** Resolves once nothing is running any more, or after `ms`. */
  settled: (ms: number) => Promise<void>;
}

/**
 * Send `signal` to `child` — with `group`, to its whole process group, which a
 * child spawned detached leads (its group id is its pid). Windows has no
 * process groups to signal: there, and if the group is gone, the child alone.
 */
export function signalCommand(child: ChildProcess, signal: NodeJS.Signals, group: boolean): void {
  // The group outlives its leader while anything it started is still in it.
  if (group && child.pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // no such group any more: fall through to the child itself
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // already gone
  }
}

export function createProcessRegistry(): ProcessRegistry {
  const actions = new Set<TrackedAction>();
  const commands = new Map<
    number,
    { label: string; child: ChildProcess; owned: boolean; group: boolean }
  >();
  const send = (c: { child: ChildProcess; group: boolean }, signal: NodeJS.Signals) =>
    signalCommand(c.child, signal, c.group);
  /** Called whenever an action or a command ends. */
  const waiters = new Set<() => void>();
  let stopping = false;

  const changed = (): void => {
    for (const waiter of [...waiters]) waiter();
  };

  const running = (): Running[] => [...commands].map(([pid, { label }]) => ({ pid, label }));

  const settled = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const idle = () => actions.size === 0 && commands.size === 0;
      if (idle()) {
        resolve();
        return;
      }
      const done = (): void => {
        clearTimeout(timer);
        waiters.delete(check);
        resolve();
      };
      const check = (): void => {
        if (idle()) done();
      };
      const timer = setTimeout(done, ms);
      waiters.add(check);
    });

  return {
    isStopping: () => stopping,

    registerAction(action) {
      // An action registered while Studio stops ends before its first command:
      // runSteps looks at isStopping() before every spawn.
      actions.add(action);
      return () => {
        if (actions.delete(action)) changed();
      };
    },

    trackCommand(child, label, { owned = false, group = false } = {}) {
      const { pid } = child;
      // A spawn that failed has no pid; it emits `error` and nothing runs.
      if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      const command = { label, child, owned, group };
      commands.set(pid, command);
      child.once("exit", () => {
        commands.delete(pid);
        changed();
      });
      if (stopping && !owned) send(command, "SIGTERM");
    },

    running,

    async stopAll(graceMs = KILL_GRACE_MS, settleMs = 1000) {
      stopping = true;
      const before = running();
      for (const action of [...actions]) action.cancel();
      for (const command of commands.values()) if (!command.owned) send(command, "SIGTERM");
      // An action kills its own command after KILL_GRACE_MS; this is for the rest.
      const kill = setTimeout(() => {
        for (const command of commands.values()) if (!command.owned) send(command, "SIGKILL");
      }, graceMs);
      await settled(graceMs + settleMs);
      clearTimeout(kill);
      const left = running();
      const gone = (r: Running) => !left.some((l) => l.pid === r.pid);
      return { stopped: before.filter(gone), left };
    },

    signalAll(signal) {
      stopping = true;
      const all = running();
      for (const action of [...actions]) action.signal(signal);
      for (const command of commands.values()) send(command, signal);
      return all;
    },

    settled,
  };
}

/** The registry of this Studio process. */
export const studioProcesses: ProcessRegistry = createProcessRegistry();
