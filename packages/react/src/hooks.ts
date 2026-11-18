"use client";

import {
  type DeployResult,
  deployContract,
  type FaucetResult,
  type FoundryArtifact,
  getBalance,
  getWalletClient,
  readContract,
  requestFaucet,
} from "@avakit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Abi, Address, Hex } from "viem";
import { useAvaKit } from "./provider.js";

/** Current account + connection status. */
export function useAvaAccount() {
  const { address, status } = useAvaKit();
  return {
    address,
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
  };
}

/** Active chain + chain switching. */
export function useAvaChain() {
  const { chain, chains, setChain } = useAvaKit();
  return { chain, chains, setChain };
}

/**
 * Native AVAX balance for an address (defaults to the connected account).
 *
 * A failed read is reported through `error` rather than thrown: `refetch()` runs
 * from effects and polling timers, where a rejection has nowhere to go.
 */
export function useBalance(address?: Address) {
  const { chain, address: connected } = useAvaKit();
  const target = address ?? connected;
  const [data, setData] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Counts requests, so a slower answer for a previous account or chain cannot
  // overwrite the balance of the current one.
  const latest = useRef(0);
  // Which account/chain `data` belongs to.
  const shownFor = useRef<string | null>(null);

  const refetch = useCallback(async () => {
    latest.current += 1;
    const current = latest.current;
    const key = target ? `${chain.id}:${target.toLowerCase()}` : null;
    if (shownFor.current !== key) {
      // Another account or chain: its balance is unknown until it has loaded,
      // so do not keep showing the previous one next to the new address.
      shownFor.current = key;
      setData(null);
      setError(null);
    }
    if (!target) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const balance = await getBalance(target, chain);
      if (current !== latest.current) return;
      setData(balance);
      setError(null);
    } catch (e) {
      if (current !== latest.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (current === latest.current) {
        setIsLoading(false);
      }
    }
  }, [target, chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

/**
 * Read/write helpers bound to a contract.
 *
 * The returned object keeps its identity for as long as the contract address,
 * the ABI, the chain and the connected wallet stay the same, so it is safe in a
 * dependency array: `useEffect(() => { contract.read(...) }, [contract])` runs
 * when one of those changes, not after every render. Pass a stable `abi` (a
 * module-level constant, not an array literal built during render).
 */
export function useContract(params: { address: Address; abi: Abi }) {
  const { chain, provider, address } = useAvaKit();

  const read = useCallback(
    (functionName: string, args?: readonly unknown[]) =>
      readContract(chain, {
        address: params.address,
        abi: params.abi,
        functionName: functionName as never,
        args,
      }),
    [chain, params.address, params.abi],
  );

  const write = useCallback(
    async (functionName: string, args?: readonly unknown[]): Promise<Hex> => {
      if (!provider || !address) {
        throw new Error("Connect a wallet before writing to a contract.");
      }
      const wallet = getWalletClient(chain, provider);
      return wallet.writeContract({
        address: params.address,
        abi: params.abi,
        functionName,
        args,
        account: address,
      } as never);
    },
    [chain, provider, address, params.address, params.abi],
  );

  return useMemo(() => ({ read, write }), [read, write]);
}

export type DeployStatus = "idle" | "deploying" | "success" | "error";

/** Deploy a compiled contract from the connected wallet. */
export function useAvaDeploy() {
  const { chain, provider, address } = useAvaKit();
  const [status, setStatus] = useState<DeployStatus>("idle");
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const deploy = useCallback(
    async (
      artifact: FoundryArtifact | { abi: Abi; bytecode: Hex },
      args?: readonly unknown[],
      opts?: { confirmMainnet?: boolean },
    ): Promise<DeployResult> => {
      if (!provider || !address) {
        throw new Error("Connect a wallet before deploying.");
      }
      setStatus("deploying");
      setError(null);
      try {
        const deployed = await deployContract({
          artifact,
          args,
          chain,
          provider,
          account: address,
          confirmMainnet: opts?.confirmMainnet,
        });
        setResult(deployed);
        setStatus("success");
        return deployed;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus("error");
        throw err;
      }
    },
    [chain, provider, address],
  );

  return { deploy, status, result, error };
}

export type TxStatus = "idle" | "pending" | "success" | "error";

/** Send a transaction from the connected wallet, with status + explorer link. */
export function useSendTransaction() {
  const { chain, provider, address } = useAvaKit();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [hash, setHash] = useState<Hex | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const send = useCallback(
    async (tx: { to: Address; value?: bigint; data?: Hex }): Promise<Hex> => {
      if (!provider || !address) {
        throw new Error("Connect a wallet before sending a transaction.");
      }
      setStatus("pending");
      setError(null);
      setHash(null);
      try {
        const wallet = getWalletClient(chain, provider);
        const txHash = await wallet.sendTransaction({
          account: address,
          to: tx.to,
          value: tx.value,
          data: tx.data,
        } as Parameters<typeof wallet.sendTransaction>[0]);
        setHash(txHash);
        setStatus("success");
        return txHash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus("error");
        throw err;
      }
    },
    [chain, provider, address],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setHash(null);
    setError(null);
  }, []);

  return {
    send,
    reset,
    status,
    hash,
    error,
    isPending: status === "pending",
    // Null on a chain without an explorer (a fresh L1), rather than a relative
    // "/tx/0x…" link that would point back into the app.
    explorerUrl: hash && chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : null,
  };
}

export type FaucetStatus = "idle" | "funding" | "success" | "error";

/**
 * Request testnet funds for the connected account from the app's AvaKit faucet
 * (set `faucetUrl` on `<AvaKitProvider>`). `enabled` is false when no faucet is
 * configured, so UIs can hide the button.
 */
export function useFaucet() {
  const { chain, address, faucetUrl } = useAvaKit();
  const [status, setStatus] = useState<FaucetStatus>("idle");
  const [result, setResult] = useState<FaucetResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fund = useCallback(
    async (target?: Address): Promise<FaucetResult> => {
      const to = target ?? address;
      if (!faucetUrl) {
        throw new Error("No faucetUrl configured on AvaKitProvider.");
      }
      if (!to) {
        throw new Error("Connect a wallet (or pass an address) before requesting funds.");
      }
      setStatus("funding");
      setError(null);
      try {
        const res = await requestFaucet({ url: faucetUrl, address: to, chainId: chain.id });
        setResult(res);
        setStatus("success");
        return res;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus("error");
        throw err;
      }
    },
    [faucetUrl, address, chain.id],
  );

  return {
    fund,
    status,
    result,
    error,
    isFunding: status === "funding",
    enabled: Boolean(faucetUrl),
  };
}
