declare global {
  interface Window {
    __AVAKIT_STUDIO__?: { token: string };
  }
}

const TOKEN = window.__AVAKIT_STUDIO__?.token ?? "";

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-studio-token": TOKEN } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "x-studio-token": TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export type DevnetAction = "start" | "stop" | "create-icm" | "create-l1";

/** Params for the create-l1 action (launch your own single L1). */
export interface L1Params {
  name: string;
  chainId: string;
  token: string;
}

/** Open the SSE action log. Returns a stop() that closes the stream. */
export function streamAction(
  action: DevnetAction,
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
  params?: L1Params,
): () => void {
  const extra = params
    ? `&name=${encodeURIComponent(params.name)}&chainId=${encodeURIComponent(params.chainId)}&token=${encodeURIComponent(params.token)}`
    : "";
  const es = new EventSource(
    `/api/devnet/stream?action=${action}&token=${encodeURIComponent(TOKEN)}${extra}`,
  );
  es.addEventListener("line", (e) => onLine(JSON.parse((e as MessageEvent).data).line as string));
  es.addEventListener("done", (e) => {
    onDone(JSON.parse((e as MessageEvent).data).exitCode as number);
    es.close();
  });
  es.onerror = () => {
    es.close();
    onDone(-1);
  };
  return () => es.close();
}

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
  ready: boolean;
  chains: IcmChain[];
}

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
}
