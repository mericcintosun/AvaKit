import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { runBackend } from "./api";
import { createRunStore, type RunInfo, type RunStore, type StartRunRequest } from "./lib/run-store";

const RunCtx = createContext<RunStore | null>(null);

/** How often an idle tab asks whether another tab has started an action. */
const POLL_MS = 5000;

/**
 * Holds the run store for the whole dashboard, ABOVE the view switch — so the
 * console, the busy state and the wizard step survive navigating between views.
 */
export function RunProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createRunStore(runBackend));

  useEffect(() => {
    // Pick up whatever the server is running (after a reload, or from another
    // tab), then keep checking while idle.
    void store.sync();
    const timer = setInterval(() => void store.sync(), POLL_MS);
    return () => {
      clearInterval(timer);
      store.stop();
    };
  }, [store]);

  return <RunCtx.Provider value={store}>{children}</RunCtx.Provider>;
}

function useStore(): RunStore {
  const store = useContext(RunCtx);
  if (!store) throw new Error("the run hooks must be used inside <RunProvider>");
  return store;
}

export interface RunStatus {
  /** The run on screen: in flight, or the last finished one. */
  run: RunInfo | null;
  /** An avalanche-cli action is in flight — nothing else may be started. */
  busy: boolean;
  /** The connection to a running action was lost; it may still be going. */
  lost: boolean;
  onFinished: (listener: (run: RunInfo) => void) => () => void;
}

/**
 * The current run WITHOUT its log, for the parts of the dashboard that only
 * care whether something is running — they do not re-render on every line.
 */
export function useRunStatus(): RunStatus {
  const store = useStore();
  const run = useSyncExternalStore(store.subscribe, () => store.getSnapshot().run);
  const lost = useSyncExternalStore(store.subscribe, () => store.getSnapshot().lost);
  return { run, lost, busy: run?.status === "running" && !lost, onFinished: store.onFinished };
}

export interface RunApi extends RunStatus {
  log: string[];
  start: (request: StartRunRequest) => Promise<RunInfo>;
  cancel: () => Promise<void>;
  dismiss: () => Promise<void>;
}

/** The current run with its live log, and the actions on it. */
export function useRun(): RunApi {
  const store = useStore();
  const status = useRunStatus();
  const log = useSyncExternalStore(store.subscribe, () => store.getSnapshot().log);
  return { ...status, log, start: store.start, cancel: store.cancel, dismiss: store.dismiss };
}
