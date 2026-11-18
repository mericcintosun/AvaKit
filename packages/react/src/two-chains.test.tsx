import { burnerAdapter, defineChain, ensureChain, getWalletClient } from "@avakit/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** Answer the JSON-RPC calls a transaction needs, and log where each one went. */
function stubChainRpc(): RpcCall[] {
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
      const payload =
        body.method in results
          ? { jsonrpc: "2.0", id: body.id, result: results[body.method] }
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
  });
});
