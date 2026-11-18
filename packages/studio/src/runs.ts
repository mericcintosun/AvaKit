/**
 * One avalanche-cli action at a time, owned by the server — not by the browser
 * tab that started it. A run keeps going when its tab navigates away, reloads
 * or closes; any tab can (re)attach to its log, and a second action is refused
 * while one is in flight, because concurrent avalanche-cli runs against the
 * same local network (or the same Fuji deploy) corrupt each other.
 */

import type { RunHandle } from "./steps.js";

export type RunKind = "devnet" | "fuji";

export interface RunInfo {
  id: number;
  kind: RunKind;
  action: string;
  /** The validated request values the action was started with. Never secrets. */
  params: Record<string, string>;
  status: "running" | "done";
  /** Null while running. */
  exitCode: number | null;
  /** True when the run was stopped through cancel(). */
  cancelled: boolean;
  startedAt: number;
  finishedAt: number | null;
}

/** Starts the action; must call `onDone` exactly once (see runSteps). */
export type Launch = (
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
) => RunHandle;

export interface RunSubscriber {
  onLine: (line: string) => void;
  onDone: (run: RunInfo) => void;
}

export interface Attachment {
  run: RunInfo;
  /** Everything the run has printed so far (the most recent MAX_LOG_LINES). */
  log: string[];
  detach: () => void;
}

export type StartResult =
  /** The action was started (it may already have finished, if it failed at once). */
  | { started: true; run: RunInfo }
  /** Refused: `run` is the action still in flight. */
  | { started: false; run: RunInfo };

export interface RunManager {
  /** The run in flight, or the last finished one until it is dismissed or replaced. */
  current: () => RunInfo | null;
  start: (
    spec: { kind: RunKind; action: string; params?: Record<string, string> },
    launch: Launch,
  ) => StartResult;
  /** Follow the current run: its log so far, then live lines until it is done. */
  attach: (subscriber: RunSubscriber) => Attachment | null;
  /** Stop the run in flight. It is reported done once its process has exited. */
  cancel: () => RunInfo | null;
  /** Forget a finished run. False while a run is still in flight. */
  dismiss: () => boolean;
}

/** A long action (a Fuji node sync) can print a lot; keep the tail. */
export const MAX_LOG_LINES = 5000;

interface Entry {
  info: RunInfo;
  log: string[];
  subscribers: Set<RunSubscriber>;
  handle: RunHandle | null;
  cancelRequested: boolean;
}

/** A caller's copy of a run: changing it never changes the run itself. */
function copy(info: RunInfo): RunInfo {
  return { ...info, params: { ...info.params } };
}

export function createRunManager(): RunManager {
  let nextId = 1;
  let entry: Entry | null = null;

  const push = (e: Entry, line: string): void => {
    if (e.info.status !== "running") return;
    e.log.push(line);
    if (e.log.length > MAX_LOG_LINES) e.log.splice(0, e.log.length - MAX_LOG_LINES);
    for (const s of [...e.subscribers]) {
      try {
        s.onLine(line);
      } catch {
        // A broken subscriber (a closed connection) must not break the run.
      }
    }
  };

  const finish = (e: Entry, exitCode: number): void => {
    if (e.info.status !== "running") return;
    e.info.status = "done";
    e.info.exitCode = exitCode;
    e.info.cancelled = e.cancelRequested;
    e.info.finishedAt = Date.now();
    const subscribers = [...e.subscribers];
    e.subscribers.clear();
    for (const s of subscribers) {
      try {
        s.onDone(copy(e.info));
      } catch {
        // see push()
      }
    }
  };

  return {
    current: () => (entry ? copy(entry.info) : null),

    start(spec, launch) {
      if (entry?.info.status === "running") return { started: false, run: copy(entry.info) };
      const e: Entry = {
        info: {
          id: nextId++,
          kind: spec.kind,
          action: spec.action,
          params: { ...spec.params },
          status: "running",
          exitCode: null,
          cancelled: false,
          startedAt: Date.now(),
          finishedAt: null,
        },
        log: [],
        subscribers: new Set(),
        handle: null,
        cancelRequested: false,
      };
      entry = e;
      try {
        e.handle = launch(
          (line) => push(e, line),
          (exitCode) => finish(e, exitCode),
        );
      } catch (err) {
        push(e, `error: ${err instanceof Error ? err.message : String(err)}`);
        finish(e, 1);
      }
      return { started: true, run: copy(e.info) };
    },

    attach(subscriber) {
      const e = entry;
      if (!e) return null;
      if (e.info.status === "running") e.subscribers.add(subscriber);
      return {
        run: copy(e.info),
        log: [...e.log],
        detach: () => {
          e.subscribers.delete(subscriber);
        },
      };
    },

    cancel() {
      const e = entry;
      if (!e) return null;
      if (e.info.status === "running" && !e.cancelRequested) {
        e.cancelRequested = true;
        e.handle?.cancel();
      }
      return copy(e.info);
    },

    dismiss() {
      if (entry?.info.status === "running") return false;
      entry = null;
      return true;
    },
  };
}
