"use client";

import {
  type AvaChain,
  ensureChain,
  isMainnet,
  requestFaucet,
  type WalletAdapter,
  type WalletConnection,
  WalletConnectionError,
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

/** Adapter id of the temporary in-browser wallet (`burnerAdapter()` in @avakit/core). */
export const BURNER_ADAPTER_ID = "burner";

/**
 * The burner keeps its key in localStorage in the clear, so it is testnet-only.
 * The adapter enforces that for the chain it was created with and for chains it
 * is asked to switch to; this is the same refusal for the chain the app is on.
 */
function burnerOnMainnetError(chain: AvaChain): Error {
  // isMainnet() reads a definition without a boolean `testnet` flag (possible
  // from plain JavaScript or JSON) as a mainnet. Say so first, or the developer
  // of a mis-defined testnet has no way to tell why the burner is refused.
  const unflagged = typeof (chain as { testnet?: unknown }).testnet !== "boolean";
  const why = unflagged
    ? `${chain.name} has no boolean \`testnet\` flag in its definition, so it is treated as a ` +
      "mainnet (set testnet: true if it is a testnet). "
    : "";
  return new WalletConnectionError(
    `${why}The temporary (burner) wallet is testnet-only and cannot be used on ${chain.name}. ` +
      "Connect a real wallet (injected / social) to use mainnet.",
  );
}

/** A ref that always holds the latest value, for callbacks that must keep their identity. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

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
  const teardown = useRef<Promise<void> | null>(null);
  // Read through a ref so `connect` keeps its identity when the chain changes.
  const chainRef = useLatest(chain);
  // `chains` is usually an inline array, new on every render of the parent.
  const chainsRef = useLatest(chains);

  const connect = useCallback(
    async (adapterId?: string) => {
      setError(null);
      const adapter = adapterId ? adapters.find((a) => a.id === adapterId) : adapters[0];
      if (!adapter) {
        setError(new Error(`No wallet adapter${adapterId ? ` "${adapterId}"` : ""} configured.`));
        return;
      }
      // Never hand out a burner on a mainnet. The adapter's own check only knows
      // the chain it was created with (Fuji by default), not the app's chain.
      if (adapter.id === BURNER_ADAPTER_ID && isMainnet(chainRef.current)) {
        setError(burnerOnMainnetError(chainRef.current));
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
    [adapters, chainRef],
  );

  const disconnect = useCallback(async () => {
    // One teardown at a time. An adapter's own logout can make the wallet emit
    // `disconnect` / `accountsChanged([])`, and the wallet listeners below
    // answer those events by calling this again.
    if (teardown.current) {
      return teardown.current;
    }
    // Mark the teardown as running before the adapter is touched: its
    // disconnect() may emit those events synchronously.
    let finish: () => void = () => {};
    teardown.current = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
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
    } finally {
      teardown.current = null;
      finish();
    }
  }, [adapters, activeAdapterId]);
  const disconnectRef = useLatest(disconnect);

  // Follow what the user does in the wallet itself. EIP-1193 providers announce
  // account switches, network switches and the end of a session; without these
  // listeners the app keeps showing, and signing with, an account the wallet has
  // already moved on from. Adapter-agnostic: it only needs the provider.
  useEffect(() => {
    if (status !== "connected" || !provider) {
      return;
    }
    if (typeof provider.on !== "function" || typeof provider.removeListener !== "function") {
      return;
    }
    let live = true;

    const onAccountsChanged = (accounts: readonly Address[]) => {
      if (!Array.isArray(accounts)) {
        return;
      }
      const next = accounts[0];
      if (!next) {
        // The wallet was locked or the site's access revoked: nothing is
        // connected any more.
        void disconnectRef.current();
        return;
      }
      // Wallets report addresses in either case; only a different account counts.
      setAddress((current) => (current?.toLowerCase() === next.toLowerCase() ? current : next));
    };

    const onChainChanged = (chainId: string | number) => {
      const id = Number(chainId);
      const next = chainsRef.current.find((c) => c.id === id);
      // Follow the wallet to another chain this app supports. A chain it does
      // not support is left alone: the app keeps its chain, and the next
      // transaction reports the mismatch instead of being sent somewhere else.
      if (next) {
        setChain((current) => (current.id === id ? current : next));
      }
    };

    const onDisconnect = (reason?: { code?: number }) => {
      // MetaMask emits code 1013 while it is only reconnecting to its network.
      // The session survives that, so drop it only if the accounts are gone.
      if (reason?.code === 1013) {
        provider.request({ method: "eth_accounts" }).then(
          (accounts) => {
            if (live && accounts.length === 0) {
              void disconnectRef.current();
            }
          },
          () => {
            // Cannot tell yet; keep the session, as the wallet says it is recoverable.
          },
        );
        return;
      }
      void disconnectRef.current();
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    provider.on("disconnect", onDisconnect);
    return () => {
      live = false;
      provider.removeListener("accountsChanged", onAccountsChanged);
      provider.removeListener("chainChanged", onChainChanged);
      provider.removeListener("disconnect", onDisconnect);
    };
  }, [status, provider, chainsRef, disconnectRef]);

  // Keep the connected wallet on the active chain (Web3Auth defaults to
  // Sepolia; injected wallets may be elsewhere). Embedded wallets switch via
  // their own SDK (adapter.switchChain); others fall back to generic ensureChain.
  useEffect(() => {
    if (status !== "connected" || !provider) {
      return;
    }
    const active = adapters.find((a) => a.id === activeAdapterId);
    // A burner on a mainnet is dropped by the effect below; never ask it to
    // switch there (it would only refuse).
    if (active?.id === BURNER_ADAPTER_ID && isMainnet(chain)) {
      return;
    }
    const run = active?.switchChain ? active.switchChain(chain) : ensureChain(provider, chain);
    void run.catch((e) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [status, provider, chain, adapters, activeAdapterId]);

  // A burner must not stay connected once the app is on a mainnet. Its provider
  // would remain on its testnet, but the UI would present the localStorage-key
  // address as the connected mainnet account, with its mainnet balance, and
  // invite real deposits. This catches every route to that state: setChain(), a
  // connect that raced a chain change, or a mainnet as the app's only chain.
  // (audit A8)
  useEffect(() => {
    if (status !== "connected" || activeAdapterId !== BURNER_ADAPTER_ID || !isMainnet(chain)) {
      return;
    }
    setError(burnerOnMainnetError(chain));
    void disconnectRef.current();
  }, [status, activeAdapterId, chain, disconnectRef]);

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
    if (!hasInjected && !isMainnet(chain) && adapters.some((a) => a.id === BURNER_ADAPTER_ID)) {
      autoBurnerTried.current = true;
      void connect(BURNER_ADAPTER_ID);
    }
  }, [autoConnect, status, adapters, connect, chain]);

  // Auto-fund a freshly-connected burner from the app's faucet (once per address)
  // so the zero-config wallet can transact with no manual faucet step.
  useEffect(() => {
    if (
      !faucetUrl ||
      status !== "connected" ||
      !address ||
      activeAdapterId !== BURNER_ADAPTER_ID ||
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
