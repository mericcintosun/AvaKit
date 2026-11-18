/**
 * The dashboard's view of the server's current avalanche-cli action ("run").
 *
 * The server owns a run; this store only mirrors it. That is what lets a run
 * survive the things that used to lose it: switching views (the store lives
 * above them), reloading or reopening the tab (the log is replayed from the
 * server), and a second tab (it follows the same run instead of starting
 * another one). Framework-free so it can be tested without a browser.
 */

export type RunKind = "devnet" | "fuji";

export interface RunInfo {
  id: number;
  kind: RunKind;
  action: string;
  /** The validated request values the action was started with. */
  params: Record<string, string>;
  status: "running" | "done";
  exitCode: number | null;
  cancelled: boolean;
  startedAt: number;
  finishedAt: number | null;
}

export type StartRunRequest =
  | {
      kind: "devnet";
      action: "start" | "stop" | "create-icm" | "create-l1";
      name?: string;
      chainId?: string;
      symbol?: string;
    }
  | {
      kind: "fuji";
      action: "transfer" | "deploy";
      name: string;
      chainId?: string;
      symbol?: string;
      amount?: string;
    };

export type StartRunResult =
  | { started: true; run: RunInfo }
  /** Refused: `run` is the action that is still in flight. */
  | { started: false; run: RunInfo; error: string };

export interface RunStreamHandlers {
  /** First event of every (re)connection: the run and everything it printed so far. */
  onSnapshot: (run: RunInfo, log: string[]) => void;
  onLine: (line: string) => void;
  onDone: (run: RunInfo) => void;
  /** `fatal` = the connection will not come back on its own. */
  onError: (fatal: boolean) => void;
}

/** How the store talks to the server (the real one is in api.ts). */
export interface RunBackend {
  fetchRun: () => Promise<RunInfo | null>;
  startRun: (request: StartRunRequest) => Promise<StartRunResult>;
  cancelRun: () => Promise<void>;
  dismissRun: () => Promise<void>;
  openStream: (handlers: RunStreamHandlers) => { close: () => void };
}

export interface RunView {
  /** The run this tab shows: the one in flight, or the last finished one. */
  run: RunInfo | null;
  log: string[];
  /** The live connection dropped while the run was going — it may still be running. */
  lost: boolean;
}

/** Thrown by start() when another action already holds the lock. */
export class RunBusyError extends Error {
  readonly run: RunInfo;
  constructor(run: RunInfo, message: string) {
    super(message);
    this.name = "RunBusyError";
    this.run = run;
  }
}

export interface RunStore {
  getSnapshot: () => RunView;
  subscribe: (listener: () => void) => () => void;
  /** Catch up with the server: follow its current run if this tab is not already. */
  sync: () => Promise<void>;
  /** Start an action and follow it. Rejects with RunBusyError when one is in flight. */
  start: (request: StartRunRequest) => Promise<RunInfo>;
  cancel: () => Promise<void>;
  /** Forget the finished run (and its log), here and on the server. */
  dismiss: () => Promise<void>;
  /** Fires once when a run this tab saw running comes to an end. */
  onFinished: (listener: (run: RunInfo) => void) => () => void;
  /** Stop following (the run itself is untouched). sync() resumes. */
  stop: () => void;
}

/** Same bound as the server's buffer. */
export const MAX_LOG_LINES = 5000;

/** Consecutive stream errors tolerated while the browser retries on its own. */
const MAX_STREAM_RETRIES = 5;

const EMPTY: RunView = { run: null, log: [], lost: false };

export function createRunStore(backend: RunBackend): RunStore {
  let view: RunView = EMPTY;
  const listeners = new Set<() => void>();
  const finishedListeners = new Set<(run: RunInfo) => void>();
  let stream: { close: () => void } | null = null;
  // Bumped whenever the stream is replaced or dropped, so events from an old
  // connection (or a sync that was overtaken) are ignored.
  let generation = 0;

  const set = (next: RunView): void => {
    view = next;
    for (const listener of [...listeners]) listener();
  };

  const detach = (): void => {
    generation++;
    stream?.close();
    stream = null;
  };

  /** Follow the server's current run. `sawRunning`: this tab already knows it as running. */
  const attach = (sawRunning: boolean): void => {
    detach();
    const mine = generation;
    let live = sawRunning;
    let failures = 0;
    const opened = backend.openStream({
      onSnapshot: (run, log) => {
        if (mine !== generation) return;
        failures = 0;
        if (run.status === "running") live = true;
        set({ run, log: log.slice(-MAX_LOG_LINES), lost: false });
      },
      onLine: (line) => {
        if (mine !== generation) return;
        const log = [...view.log, line];
        if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
        set({ ...view, log });
      },
      onDone: (run) => {
        if (mine !== generation) return;
        detach();
        set({ ...view, run, lost: false });
        // A run that had already ended before this tab looked is old news.
        if (live) for (const listener of [...finishedListeners]) listener(run);
      },
      onError: (fatal) => {
        if (mine !== generation) return;
        // The browser reconnects by itself and the server then sends a fresh
        // snapshot, so a blip costs nothing. Give up only when it is final.
        if (!fatal && ++failures <= MAX_STREAM_RETRIES) return;
        detach();
        if (view.run?.status === "running") set({ ...view, lost: true });
      },
    });
    // A handler may already have ended this stream (a finished run).
    if (mine === generation) stream = opened;
    else opened.close();
  };

  return {
    getSnapshot: () => view,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async sync() {
      if (stream) return; // already following a run; its stream reports the end
      const mine = generation;
      let run: RunInfo | null;
      try {
        run = await backend.fetchRun();
      } catch {
        return; // unreachable right now — keep what we show and try again later
      }
      if (mine !== generation || stream) return;

      const known = view.run;
      if (!run) {
        // Nothing on the server. A run we still show as running is gone with it
        // (Studio was restarted); a finished one was dismissed in another tab.
        if (known?.status === "running") {
          if (!view.lost) set({ ...view, lost: true });
        } else if (known) {
          set(EMPTY);
        }
        return;
      }
      if (known?.id === run.id && known.status === "done" && run.status === "done") return;
      attach(known?.id === run.id && known.status === "running");
    },

    async start(request) {
      const result = await backend.startRun(request);
      if (!result.started) {
        // Another action holds the lock (another tab started it): show that one.
        if (!stream || view.run?.id !== result.run.id) {
          set({ run: result.run, log: [], lost: false });
          attach(true);
        }
        throw new RunBusyError(result.run, result.error);
      }
      set({ run: result.run, log: [], lost: false });
      attach(true);
      return result.run;
    },

    async cancel() {
      await backend.cancelRun();
    },

    async dismiss() {
      await backend.dismissRun();
      detach();
      set(EMPTY);
    },

    onFinished(listener) {
      finishedListeners.add(listener);
      return () => {
        finishedListeners.delete(listener);
      };
    },

    stop: detach,
  };
}
