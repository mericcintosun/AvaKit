import type { Chain, EIP1193Provider } from "viem";
import { numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AvaChain, cChain, fuji } from "../chains.js";
import { WalletConnectionError } from "../errors.js";
import { stubRpc } from "../testing/rpc.js";
import { burnerAdapter } from "./burner.js";

// The burner asks the node which chain it serves before it sends, but that
// answer is the node's word. What makes a transaction worthless on any other
// chain is the chain id inside the signature (EIP-155), so the signer has to
// refuse a transaction that names another chain no matter how it came about.
//
// With viem 2.58.0 and a chain on the client, the prepared request always
// carries the client's chain id, so that case cannot be produced through the
// node. This file produces it the way a different viem could: the chain handed
// to the wallet client gets a `prepareTransactionRequest` hook (a real viem
// feature) that rewrites the chain id after the burner's own check has passed.

/** The chain id the hook writes into the prepared request, or undefined to leave it alone. */
const prepared = vi.hoisted(() => ({ chainId: undefined as number | undefined }));

vi.mock("../clients.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../clients.js")>();
  return {
    ...actual,
    toViemChain: (chain: AvaChain): Chain => ({
      ...actual.toViemChain(chain),
      prepareTransactionRequest: [
        async (request) =>
          prepared.chainId === undefined ? request : { ...request, chainId: prepared.chainId },
        { runAt: ["beforeFillParameters"] },
      ],
    }),
  };
});

// A well-known throwaway test key (Hardhat/anvil account #0). Never real funds.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TEST_ADDRESS = privateKeyToAccount(TEST_KEY).address;
const TX_HASH = `0x${"ab".repeat(32)}` as const;

/** A node that says it serves Fuji and accepts whatever it is sent. */
function stubAgreeableNode() {
  return stubRpc({
    eth_chainId: () => numberToHex(fuji.id),
    eth_getTransactionCount: () => "0x0",
    eth_estimateGas: () => "0x5208",
    eth_getBlockByNumber: () => ({ number: "0x10", baseFeePerGas: "0x3b9aca00" }),
    eth_maxPriorityFeePerGas: () => "0x1",
    eth_gasPrice: () => "0x3b9aca00",
    eth_sendRawTransaction: () => TX_HASH,
  });
}

async function connect(): Promise<EIP1193Provider> {
  const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
  return (await adapter.connect()).provider;
}

function send(provider: EIP1193Provider) {
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from: TEST_ADDRESS, to: TEST_ADDRESS, value: "0x0" }],
  });
}

afterEach(() => {
  prepared.chainId = undefined;
  vi.unstubAllGlobals();
});

describe("burner signer", () => {
  it("signs a transaction prepared for the definition's chain", async () => {
    const calls = stubAgreeableNode();

    expect(await send(await connect())).toBe(TX_HASH);

    expect(calls.filter((call) => call.method === "eth_sendRawTransaction")).toHaveLength(1);
  });

  it("refuses a transaction prepared for a mainnet, after the node check has passed", async () => {
    const calls = stubAgreeableNode();
    const provider = await connect();
    prepared.chainId = cChain.id;

    const sent = send(provider);

    // The burner's own error, not viem's wrapper around it.
    await expect(sent).rejects.toBeInstanceOf(WalletConnectionError);
    await expect(sent).rejects.toThrow(
      "Nothing was signed or sent: Avalanche Fuji is defined as chain 43113, but the transaction " +
        "handed to the signer names chain 43114, which is a mainnet. The temporary (burner) " +
        "wallet is testnet-only. Point the definition's rpcUrl at a chain 43113 node, or connect " +
        "a real wallet (injected / social) to use mainnet.",
    );
    // The node check did pass, so only the signer stood in the way.
    expect(calls.map((call) => call.method)).toContain("eth_chainId");
    expect(calls.map((call) => call.method)).not.toContain("eth_sendRawTransaction");
  });

  it("refuses a transaction prepared for any other chain", async () => {
    const calls = stubAgreeableNode();
    const provider = await connect();
    prepared.chainId = 43113001;

    const sent = send(provider);

    await expect(sent).rejects.toBeInstanceOf(WalletConnectionError);
    await expect(sent).rejects.toThrow(
      "Nothing was signed or sent: Avalanche Fuji is defined as chain 43113, but the transaction " +
        "handed to the signer names chain 43113001. The temporary (burner) wallet signs only " +
        "for the chain its definition names. Make the definition's id and rpcUrl describe the " +
        "same chain, then try again.",
    );
    expect(calls.map((call) => call.method)).not.toContain("eth_sendRawTransaction");
  });
});
