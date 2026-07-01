"use client";

import {
  type AvaChain,
  ensureChain,
  type WalletAdapter,
  type WalletConnection,
} from "@avakit/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Address, EIP1193Provider } from "viem";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface AvaKitContextValue {
  chains: AvaChain[];
  chain: AvaChain;
  setChain: (chain: AvaChain) => void;
  adapters: WalletAdapter[];
  status: ConnectionStatus;
  address: Address | null;
  provider: EIP1193Provider | null;
  activeAdapterId: string | null;
  error: Error | null;
  connect: (adapterId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const AvaKitContext = createContext<AvaKitContextValue | null>(null);

export function useAvaKit(): AvaKitContextValue {
  const ctx = useContext(AvaKitContext);
  if (!ctx) {
    throw new Error("useAvaKit must be used within <AvaKitProvider>.");
  }
  return ctx;
}

export interface AvaKitProviderProps {
  /** Supported chains; the first is the default. */
  chains: AvaChain[];
  /** Wallet adapters, e.g. [injectedAdapter(), web3authAdapter({ clientId })]. */
  adapters: WalletAdapter[];
  children: ReactNode;
}

export function AvaKitProvider({ chains, adapters, children }: AvaKitProviderProps) {
  const [chain, setChain] = useState<AvaChain>(() => {
    const first = chains[0];
    if (!first) {
      throw new Error("AvaKitProvider requires at least one chain.");
    }
    return first;
  });
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [address, setAddress] = useState<Address | null>(null);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [activeAdapterId, setActiveAdapterId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const connect = useCallback(
    async (adapterId?: string) => {
      setError(null);
      const adapter = adapterId ? adapters.find((a) => a.id === adapterId) : adapters[0];
      if (!adapter) {
        setError(new Error(`No wallet adapter${adapterId ? ` "${adapterId}"` : ""} configured.`));
        return;
      }
      setStatus("connecting");
      setActiveAdapterId(adapter.id);
      try {
        const conn: WalletConnection = await adapter.connect();
        setAddress(conn.address);
        setProvider(conn.provider);
        setStatus("connected");
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setStatus("disconnected");
        setActiveAdapterId(null);
      }
    },
    [adapters],
  );

  const disconnect = useCallback(async () => {
    const adapter = adapters.find((a) => a.id === activeAdapterId);
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        // best-effort
      }
    }
    setAddress(null);
    setProvider(null);
    setStatus("disconnected");
    setActiveAdapterId(null);
  }, [adapters, activeAdapterId]);

  // Keep the connected wallet on the active chain (Web3Auth defaults to
  // Sepolia; injected wallets may be elsewhere). Embedded wallets switch via
  // their own SDK (adapter.switchChain); others fall back to generic ensureChain.
  useEffect(() => {
    if (status !== "connected" || !provider) {
      return;
    }
    const active = adapters.find((a) => a.id === activeAdapterId);
    const run = active?.switchChain ? active.switchChain(chain) : ensureChain(provider, chain);
    void run.catch((e) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [status, provider, chain, adapters, activeAdapterId]);

  const value = useMemo<AvaKitContextValue>(
    () => ({
      chains,
      chain,
      setChain,
      adapters,
      status,
      address,
      provider,
      activeAdapterId,
      error,
      connect,
      disconnect,
    }),
    [
      chains,
      chain,
      adapters,
      status,
      address,
      provider,
      activeAdapterId,
      error,
      connect,
      disconnect,
    ],
  );

  return <AvaKitContext.Provider value={value}>{children}</AvaKitContext.Provider>;
}
