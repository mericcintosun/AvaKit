"use client";

import {
  type AvaChain,
  ensureChain,
  isMainnet,
  requestFaucet,
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
  useRef,
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
  /** Optional AvaCloud Data API key used by the data hooks (keyless otherwise). */
  dataApiKey?: string;
  /** Optional AvaKit faucet endpoint used by useFaucet() and burner auto-funding. */
  faucetUrl?: string;
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
  /** Optional AvaCloud Data API key for the data hooks (useTokenBalances, useNfts, useTxHistory). */
  dataApiKey?: string;
  /** Optional AvaKit faucet endpoint. Enables useFaucet() and auto-funds a burner on connect. */
  faucetUrl?: string;
  /** Auto-connect a temporary (burner) wallet on mount when no injected wallet is present. */
  autoConnect?: "burner";
  children: ReactNode;
}

export function AvaKitProvider({
  chains,
  adapters,
  dataApiKey,
  faucetUrl,
  autoConnect,
  children,
}: AvaKitProviderProps) {
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
  const autoBurnerTried = useRef(false);
  const fundedAddresses = useRef<Set<string>>(new Set());

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

  // Auto-connect a temporary (burner) wallet when the app opts in and the visitor
  // has no injected wallet, so a stranger lands already connected. Runs once.
  // Never on mainnet: the burner is testnet-only, so auto-connecting it there
  // would just error. (audit A8)
  useEffect(() => {
    if (autoConnect !== "burner" || autoBurnerTried.current || status !== "disconnected") {
      return;
    }
    const hasInjected =
      typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);
    if (!hasInjected && !isMainnet(chain) && adapters.some((a) => a.id === "burner")) {
      autoBurnerTried.current = true;
      void connect("burner");
    }
  }, [autoConnect, status, adapters, connect, chain]);

  // Auto-fund a freshly-connected burner from the app's faucet (once per address)
  // so the zero-config wallet can transact with no manual faucet step.
  useEffect(() => {
    if (
      !faucetUrl ||
      status !== "connected" ||
      !address ||
      activeAdapterId !== "burner" ||
      isMainnet(chain)
    ) {
      return;
    }
    if (fundedAddresses.current.has(address)) {
      return;
    }
    fundedAddresses.current.add(address);
    void requestFaucet({ url: faucetUrl, address, chainId: chain.id }).catch(() => {
      // Allow a retry on a transient failure.
      fundedAddresses.current.delete(address);
    });
  }, [faucetUrl, status, address, activeAdapterId, chain]);

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
      dataApiKey,
      faucetUrl,
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
      dataApiKey,
      faucetUrl,
    ],
  );

  return <AvaKitContext.Provider value={value}>{children}</AvaKitContext.Provider>;
}
