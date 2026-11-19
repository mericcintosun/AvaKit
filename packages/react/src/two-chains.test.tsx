import { burnerAdapter, defineChain, ensureChain, getWalletClient } from "@avakit/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { Hex } from "viem";
import { parseTransaction } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAvaChain } from "./hooks.js";
import { AvaKitProvider, useAvaKit } from "./provider.js";
import { humanizeError } from "./utils.js";

// Unlike provider.test.tsx this file uses the real @avakit/core (burner wallet,
// ensureChain, viem wallet client) and only replaces the network underneath.

/** Two local L1s, defined the way the icm-messenger / token-bridge templates do. */
const chain1 = defineChain({
  id: 1001,
  name: "icm1",
  rpcUrl: "http://127.0.0.1:9650/ext/bc/icm1/rpc",
  explorerUrl: "",
  nativeCurrency: { name: "ICM1", symbol: "ICM1", decimals: 18 },
  testnet: true,
});
const chain2 = defineChain({
  id: 1002,
  name: "icm2",
  rpcUrl: "http://127.0.0.1:9650/ext/bc/icm2/rpc",
  explorerUrl: "",
  nativeCurrency: { name: "ICM2", symbol: "ICM2", decimals: 18 },
  testnet: true,
});

const TX_HASH = `0x${"ab".repeat(32)}`;

interface RpcCall {
  url: string;
  method: string;
  params: unknown[];
}

/** The chain each RPC URL really serves, when it is the one its definition names. */
const HONEST_NODES: Record<string, number> = {
  [chain1.rpcUrl]: chain1.id,
  [chain2.rpcUrl]: chain2.id,
};

/**
 * Answer the JSON-RPC calls a transaction needs, and log where each one went.
 * `served` is the chain id the node behind each RPC URL reports.
 */
function stubChainRpc(served: Record<string, number> = HONEST_NODES): RpcCall[] {
  const calls: RpcCall[] = [];
  const results: Record<string, unknown> = {
    eth_getTransactionCount: "0x0",
    eth_estimateGas: "0x5208",
    eth_getBlockByNumber: { number: "0x10", baseFeePerGas: "0x3b9aca00" },
    eth_maxPriorityFeePerGas: "0x1",
    eth_gasPrice: "0x3b9aca00",
    eth_sendRawTransaction: TX_HASH,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: unknown[];
      };
      calls.push({ url, method: body.method, params: body.params ?? [] });
      const result =
        body.method === "eth_chainId" && url in served
          ? `0x${served[url]?.toString(16)}`
          : results[body.method];
      const payload =
        result !== undefined
          ? { jsonrpc: "2.0", id: body.id, result }
          : { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "not stubbed" } };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

function TwoChainDemo() {
  const { provider, address, status, connect } = useAvaKit();
  const { chain, setChain } = useAvaChain();
  const [result, setResult] = useState("idle");

  async function sendOnSecondChain() {
    if (!provider || !address) return;
    try {
      // The sequence the two-chain templates run: make sure the wallet is on the
      // target chain, tell the app, then send — without waiting for a re-render.
      await ensureChain(provider, chain2);
      setChain(chain2);
      const wallet = getWalletClient(chain2, provider);
      const hash = await wallet.sendTransaction({
        account: address,
        to: address,
        value: 0n,
      } as Parameters<typeof wallet.sendTransaction>[0]);
      setResult(hash);
    } catch (e) {
      setResult(`error: ${humanizeError(e)}`);
    }
  }

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="chain">{chain.name}</span>
      <span data-testid="result">{result}</span>
      <button type="button" onClick={() => void connect("burner")}>
        connect
      </button>
      <button type="button" onClick={() => void sendOnSecondChain()}>
        send on chain 2
      </button>
    </div>
  );
}

/**
 * Run the effects the connect left pending. "connected" is on screen as soon as
 * React commits, but the provider subscribes to the wallet and keeps it on the
 * app's chain in effects that can run a moment later; one that runs after the
 * click below would move the wallet back to the first chain. A person clicks
 * long after that; a test does not.
 */
async function settled() {
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("burner wallet across two chains", () => {
  it("sends on the second chain at the first attempt after awaiting ensureChain", async () => {
    const calls = stubChainRpc();
    render(
      <AvaKitProvider
        chains={[chain1, chain2]}
        adapters={[burnerAdapter({ chain: chain1, persist: false })]}
      >
        <TwoChainDemo />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    await settled();
    expect(screen.getByTestId("chain").textContent).toBe("icm1");

    fireEvent.click(screen.getByText("send on chain 2"));

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).not.toBe("idle");
    });
    // Used to be "error: Your wallet is on the wrong network …" on the first click.
    expect(screen.getByTestId("result").textContent).toBe(TX_HASH);
    expect(screen.getByTestId("chain").textContent).toBe("icm2");

    const broadcast = calls.filter((call) => call.method === "eth_sendRawTransaction");
    expect(broadcast).toHaveLength(1);
    expect(broadcast[0]?.url).toBe(chain2.rpcUrl);
    expect(parseTransaction(broadcast[0]?.params[0] as Hex).chainId).toBe(chain2.id);
    // Nothing was sent to, or asked of, the first chain.
    expect(calls.every((call) => call.url === chain2.rpcUrl)).toBe(true);
    // The burner asked the second chain's node which chain it serves, once,
    // before anything else.
    expect(calls[0]?.method).toBe("eth_chainId");
    expect(calls.filter((call) => call.method === "eth_chainId")).toHaveLength(1);
  });

  // The second chain says "testnet: true, id 1002", but its RPC URL leads to the
  // C-Chain mainnet. The temporary wallet must not transact there, and the app
  // must be able to tell the user why: viem wraps the wallet's refusal in "An
  // unknown RPC error occurred.", and "switch your wallet" would be no help.
  it("sends nothing, and says why, when the second chain's RPC is really a mainnet", async () => {
    const calls = stubChainRpc({ ...HONEST_NODES, [chain2.rpcUrl]: 43114 });
    render(
      <AvaKitProvider
        chains={[chain1, chain2]}
        adapters={[burnerAdapter({ chain: chain1, persist: false })]}
      >
        <TwoChainDemo />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    await settled();

    fireEvent.click(screen.getByText("send on chain 2"));

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).not.toBe("idle");
    });
    expect(screen.getByTestId("result").textContent).toBe(
      "error: Nothing was signed or sent: icm2 is defined as chain 1002, but the node at its " +
        "rpcUrl reports chain 43114, which is a mainnet. The temporary (burner) wallet is " +
        "testnet-only.",
    );
    expect(calls.map((call) => call.method)).toEqual(["eth_chainId"]);
  });
});
