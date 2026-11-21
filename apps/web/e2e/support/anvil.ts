import { spawn } from "node:child_process";

/** A throwaway local chain that answers as Fuji does: chain id 43113. */
export interface Anvil {
  /** JSON-RPC endpoint, e.g. http://127.0.0.1:53121. */
  readonly url: string;
  /** Send one JSON-RPC call and return its result, or throw its error. */
  rpc<T = unknown>(method: string, params?: unknown[]): Promise<T>;
  /** Stop the node. Safe to call more than once. */
  stop(): Promise<void>;
}

const STARTUP_TIMEOUT_MS = 20_000;
const LISTENING = /Listening on (\S+)/;

/**
 * Start a fresh anvil (Foundry) on a free port with Fuji's chain id, so a page
 * that signs for Fuji signs transactions this node accepts.
 *
 * anvil prints its well-known development accounts and their keys on startup.
 * Only the "Listening on" line is read from that output; none of it is logged.
 */
export function startAnvil({ chainId = 43113 }: { chainId?: number } = {}): Promise<Anvil> {
  const bin = process.env.ANVIL_BIN || "anvil";
  const child = spawn(bin, ["--chain-id", String(chainId), "--host", "127.0.0.1", "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

  async function stop(): Promise<void> {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    }
  }

  return new Promise<Anvil>((resolve, reject) => {
    let output = "";

    const onError = (error: NodeJS.ErrnoException) =>
      fail(
        error.code === "ENOENT"
          ? `"${bin}" was not found. These tests run a local chain with anvil from Foundry: ` +
              "install Foundry (https://getfoundry.sh) or point ANVIL_BIN at anvil."
          : `anvil could not be started: ${error.message}`,
      );
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(`anvil exited before it was ready (code ${code}, signal ${signal}).\n${stderr}`);
    const onData = (chunk: string) => {
      output = (output + chunk).slice(-4000);
      const match = LISTENING.exec(output);
      if (!match) return;
      settle();
      const url = `http://${match[1]}`;
      resolve({ url, rpc: (method, params) => rpc(url, method, params), stop });
    };

    const timer = setTimeout(
      () => fail(`anvil did not start within ${STARTUP_TIMEOUT_MS / 1000} s.\n${stderr}`),
      STARTUP_TIMEOUT_MS,
    );

    /** Stop listening for startup events. stdout keeps draining, so a full pipe never blocks anvil. */
    function settle() {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stdout.off("data", onData);
      child.stdout.resume();
    }

    function fail(message: string) {
      settle();
      void stop();
      reject(new Error(message));
    }

    child.on("error", onError);
    child.on("exit", onExit);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
  });
}

let nextId = 1;

/** One JSON-RPC call over HTTP. */
export async function rpc<T = unknown>(
  url: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method} failed: ${body.error.message ?? "unknown error"}`);
  return body.result as T;
}
