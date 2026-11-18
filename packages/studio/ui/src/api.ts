import type { FujiBalance, FujiL1 } from "./lib/fuji-wizard";
import type { RunBackend, RunInfo } from "./lib/run-store";

export type { FujiBalance, FujiL1 } from "./lib/fuji-wizard";

declare global {
  interface Window {
    __AVAKIT_STUDIO__?: { token: string };
  }
}

const TOKEN = window.__AVAKIT_STUDIO__?.token ?? "";

/** An API failure that carries the HTTP status so callers can special-case 401. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(
      message ??
        (status === 401
          ? "Studio didn't recognize this tab's session token — it was likely restarted. Reload this page, or reopen the URL printed in your terminal."
          : `HTTP ${status}`),
    );
    this.name = "ApiError";
    this.status = status;
  }
}

/** The JSON of a successful response; otherwise an ApiError with the server's reason. */
async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown };
    // A 401 keeps its own, more helpful wording.
    if (res.status !== 401 && typeof body.error === "string") message = body.error;
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, message);
}

export async function api<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { headers: { "x-studio-token": TOKEN } }));
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method: "POST",
      headers: { "x-studio-token": TOKEN, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

/**
 * The server side of the run store: start an avalanche-cli action with a POST,
 * then follow it over a separate event stream. The action belongs to the
 * server, so closing the stream (or this tab) never stops it.
 */
export const runBackend: RunBackend = {
  fetchRun: async () => (await api<{ run: RunInfo | null }>("/api/run")).run,

  async startRun(request) {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "x-studio-token": TOKEN, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (res.status === 409) {
      // Another action is in flight; the server says which. `run` is null when
      // it belongs to another Studio process (the MCP face, a second dashboard).
      const body = (await res.json()) as { error: string; run: RunInfo | null };
      return { started: false, run: body.run ?? null, error: body.error };
    }
    return { started: true, run: (await parse<{ run: RunInfo }>(res)).run };
  },

  cancelRun: async () => {
    await apiPost("/api/run/cancel");
  },

  dismissRun: async () => {
    await apiPost("/api/run/dismiss");
  },

  openStream(handlers) {
    // EventSource cannot set headers, so the session token travels in the query.
    const es = new EventSource(`/api/run/stream?token=${encodeURIComponent(TOKEN)}`);
    const data = (e: Event) => JSON.parse((e as MessageEvent<string>).data);
    es.addEventListener("snapshot", (e) => {
      const { run, log } = data(e) as { run: RunInfo; log: string[] };
      handlers.onSnapshot(run, log);
    });
    es.addEventListener("line", (e) => handlers.onLine((data(e) as { line: string }).line));
    es.addEventListener("done", (e) => {
      // Close first: the server ends the stream after `done`, and an open
      // EventSource would take that as a dropped connection and reconnect.
      es.close();
      handlers.onDone((data(e) as { run: RunInfo }).run);
    });
    // CLOSED means the server refused the stream (Studio restarted, no run):
    // the browser will not retry. Anything else is a blip it retries itself.
    es.onerror = () => handlers.onError(es.readyState === EventSource.CLOSED);
    return { close: () => es.close() };
  },
};

export type DevnetAction = "start" | "stop" | "create-icm" | "create-l1";

/** Params for the create-l1 action (launch your own single L1). */
export interface L1Params {
  name: string;
  chainId: string;
  token: string;
}

export interface FujiKey {
  address: string | null;
}

export const fujiApi = {
  createKey: (name: string) => apiPost<FujiKey>("/api/fuji/key", { name }),
  balance: (name: string) => api<FujiBalance>(`/api/fuji/balance?name=${encodeURIComponent(name)}`),
  l1: (name: string) => api<FujiL1>(`/api/fuji/l1?name=${encodeURIComponent(name)}`),
};

export interface ToolInfo {
  name: string;
  installed: boolean;
  version: string | null;
  hint?: string;
}

export interface ProjectInfo {
  isAvaKit: boolean;
  name: string | null;
  template: string | null;
  hasContracts: boolean;
}

export interface Inventory {
  cwd: string;
  tools: ToolInfo[];
  project: ProjectInfo;
  localL1s: string[];
}

export interface L1Info {
  name: string;
  evmChainId: number | null;
  token: string | null;
  teleporterReady: boolean;
  teleporterMessenger: string | null;
  blockchainId: string | null;
  rpcUrl: string | null;
  deployed: boolean;
  running: boolean;
}

export interface DevnetStatus {
  running: boolean;
  l1s: L1Info[];
}

export interface IcmChain {
  name: string;
  evmChainId: number | null;
  rpcUrl: string | null;
  blockchainIdHex: string | null;
  running: boolean;
  messenger: string | null;
  lastMessage: string | null;
  messagesReceived: number | null;
}

export interface IcmState {
  /**
   * A message can be sent right now: two of the chains have a usable messenger
   * and the two are linked. Two running L1s alone are `hasPeers`.
   */
  ready: boolean;
  /** At least two running, ICM-ready L1s: enough to deploy and link messengers. */
  hasPeers: boolean;
  /** Only the running, Teleporter-ready L1s of the local network. */
  chains: IcmChain[];
  /** The longest message the server accepts, in UTF-8 bytes. */
  maxMessageBytes: number;
}

export interface IcmSendResult {
  txHash: string;
  /** The destination's delivery count just before the send. */
  receivedBefore: number | null;
}

export type DataSection = "native" | "tokens" | "nfts" | "transactions";

export interface DataSummary {
  native: { symbol: string; balance: string; decimals: number } | null;
  tokens: { address: string; symbol: string; name: string; balance: string; decimals: number }[];
  nfts: { address: string; name: string; symbol: string; tokenId: string }[];
  transactions: {
    txHash: string;
    from: string;
    to: string;
    timestamp: number;
    method: string | null;
    status: string;
  }[];
  /** Sections that could not be loaded, with the reason — unknown, NOT empty. */
  errors: Partial<Record<DataSection, string>>;
}
