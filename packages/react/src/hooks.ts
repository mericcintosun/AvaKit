"use client";

import {
  type DeployResult,
  deployContract,
  type FoundryArtifact,
  getBalance,
  getWalletClient,
  readContract,
} from "@avakit/core";
import { useCallback, useEffect, useState } from "react";
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

/** Native AVAX balance for an address (defaults to the connected account). */
export function useBalance(address?: Address) {
  const { chain, address: connected } = useAvaKit();
  const target = address ?? connected;
  const [data, setData] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!target) {
      setData(null);
      return;
    }
    setIsLoading(true);
    try {
      setData(await getBalance(target, chain));
    } finally {
      setIsLoading(false);
    }
  }, [target, chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, refetch };
}

/** Read/write helpers bound to a contract. */
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

  return { read, write };
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
