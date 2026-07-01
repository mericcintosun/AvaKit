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

export type DevnetAction = "start" | "stop" | "create-icm";

/** Open the SSE action log. Returns a stop() that closes the stream. */
export function streamAction(
  action: DevnetAction,
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
): () => void {
  const es = new EventSource(
    `/api/devnet/stream?action=${action}&token=${encodeURIComponent(TOKEN)}`,
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
