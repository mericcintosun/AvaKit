"use client";

import {
  type AvaChain,
  ensureChain,
  type FaucetResult,
  getBalance,
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
 * isMainnet() reads a definition without a boolean `testnet` flag (possible
 * from plain JavaScript or JSON) as a mainnet. A refusal that follows from it
 * says so first, or the developer of a mis-defined testnet has no way to tell
 * why they were refused. Ends with a space; empty for a chain with the flag.
 */
function missingTestnetFlagHint(chain: AvaChain): string {
  return typeof (chain as { testnet?: unknown }).testnet === "boolean"
    ? ""
    : `${chain.name} has no boolean \`testnet\` flag in its definition, so it is treated as a ` +
        "mainnet (set testnet: true if it is a testnet). ";
}

/**
 * The burner keeps its key in localStorage in the clear, so it is testnet-only.
 * The adapter enforces that for the chain it was created with and for chains it
 * is asked to switch to; this is the same refusal for the chain the app is on.
 */
function burnerOnMainnetError(chain: AvaChain): Error {
  return new WalletConnectionError(
    `${missingTestnetFlagHint(chain)}The temporary (burner) wallet is testnet-only and cannot ` +
      `be used on ${chain.name}. Connect a real wallet (injected / social) to use mainnet.`,
  );
}

/** A faucet hands out test funds. On a mainnet there is nothing for it to do. */
function faucetOnMainnetError(chain: AvaChain): Error {
  return new Error(
    `${missingTestnetFlagHint(chain)}A faucet only funds testnets, and ${chain.name} is a ` +
      "mainnet. Switch to a testnet to request funds.",
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

export type FaucetStatus = "idle" | "funding" | "success" | "error";

/**
 * The faucet as `useFaucet()` sees it. It lives in the provider, not in the
 * hook, so that the automatic drip for a burner wallet and a manual `fund()`
 * report through the same state, and every component that calls the hook reads
 * the same thing.
 */
export interface FaucetContextValue {
  status: FaucetStatus;
  result: FaucetResult | null;
  error: Error | null;
  /** True when a faucet is configured and the active chain is a testnet. */
  enabled: boolean;
  fund: (target?: Address) => Promise<FaucetResult>;
  reset: () => void;
}

// A context of its own: a drip in progress should re-render the components that
// show it, not everything that reads the wallet.
const FaucetContext = createContext<FaucetContextValue | null>(null);

/** What `useFaucet()` reads. (Internal: not part of the package's public exports.) */
export function useFaucetContext(): FaucetContextValue {
  const ctx = useContext(FaucetContext);
  if (!ctx) {
    throw new Error("useFaucet must be used within <AvaKitProvider>.");
  }
  return ctx;
}

/** The faucet state, plus the account and chain it was recorded for. */
interface FaucetState {
  status: FaucetStatus;
  result: FaucetResult | null;
  error: Error | null;
  session: string;
}

const IDLE_FAUCET: FaucetState = { status: "idle", result: null, error: null, session: "" };

/** Names the account and chain a faucet state belongs to. */
function faucetSession(chain: AvaChain, address: Address | null): string {
  return `${chain.id}:${address?.toLowerCase() ?? ""}`;
}

/**
 * How long the automatic drip waits to learn the balance before it asks the
 * faucet without knowing it. A healthy RPC answers in a fraction of this; a
 * hanging one must not leave a new wallet unfunded for as long as it hangs.
 */
const BALANCE_CHECK_TIMEOUT_MS = 5_000;

/**
 * The account's balance, or undefined when it could not be read: the RPC
 * failed, took longer than the limit, or `signal` aborted first. Never rejects.
 */
async function readBalance(
  address: Address,
  chain: AvaChain,
  signal: AbortSignal,
): Promise<bigint | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const givenUp = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, BALANCE_CHECK_TIMEOUT_MS);
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });
  try {
    const balance = await Promise.race([getBalance(address, chain), givenUp]);
    return typeof balance === "bigint" ? balance : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export interface AvaKitProviderProps {
  /** Supported chains; the first is the default. */
  chains: AvaChain[];
  /** Wallet adapters, e.g. [injectedAdapter(), web3authAdapter({ clientId })]. */
  adapters: WalletAdapter[];
  /** Optional AvaCloud Data API key for the data hooks (useTokenBalances, useNfts, useTxHistory). */
  dataApiKey?: string;
  /**
   * Optional faucet endpoint: your own deployment of the AvaKit faucet, or
   * `AVAKIT_FAUCET_URL` from @avakit/core for the shared one. Enables
   * `useFaucet()`, and funds a burner wallet that connects with an empty balance
   * on a testnet. Nothing is requested without it.
   */
  faucetUrl?: string;
  /**
   * Optional source of a captcha token (Cloudflare Turnstile), for a faucet that
   * asks for one. Called before every faucet request, each attempt of the
   * automatic drip and of `fund()` included, because a token can be used only
   * once. Return `undefined` to send none.
   */
  faucetToken?: () => Promise<string | undefined> | string | undefined;
  /** Auto-connect a temporary (burner) wallet on mount when no injected wallet is present. */
  autoConnect?: "burner";
  children: ReactNode;
}

export function AvaKitProvider({
  chains,
  adapters,
  dataApiKey,
  faucetUrl,
  faucetToken,
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

  const [faucet, setFaucet] = useState<FaucetState>(IDLE_FAUCET);
  // Counts faucet requests, so a slower answer to an earlier request cannot
  // overwrite what a later one (or a reset) has put on screen.
  const faucetRun = useRef(0);
  // Faucet requests in flight, by chain and address. Asking again for a pair
  // that is already being funded joins that request rather than sending a
  // second one, which the faucet would only refuse as "funded recently".
  const faucetInFlight = useRef<Map<string, Promise<FaucetResult>>>(new Map());
  const addressRef = useLatest(address);
  // Usually an inline function, new on every render of the parent.
  const faucetTokenRef = useLatest(faucetToken);
  // The faucet state describes one account on one chain. Once the app is on
  // another, "funded" or "refused" would be a statement about the wrong wallet,
  // so the state only counts while its session is the current one.
  const session = faucetSession(chain, address);
  const sessionRef = useLatest(session);

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

  // One request to the faucet, reported through the shared faucet state. Both
  // the automatic drip and fund() go through here, which is what lets an app
  // show "funding", "funded" or the faucet's refusal whichever of them asked.
  // `forSession` is the account and chain the app was on when it was asked.
  const runFaucet = useCallback(
    (
      url: string,
      to: Address,
      on: AvaChain,
      forSession: string,
      signal?: AbortSignal,
    ): Promise<FaucetResult> => {
      const key = `${on.id}:${to.toLowerCase()}`;
      const running = faucetInFlight.current.get(key);
      if (running) {
        return running;
      }

      faucetRun.current += 1;
      const run = faucetRun.current;
      const report = (next: Omit<FaucetState, "session">) => {
        if (run === faucetRun.current) {
          setFaucet({ ...next, session: forSession });
        }
      };
      report({ status: "funding", result: null, error: null });

      const request = (async () => {
        try {
          // requestFaucet retries a failure that may be temporary (a bounded
          // number of times) and limits every attempt, so this settles.
          const result = await requestFaucet({
            url,
            address: to,
            chainId: on.id,
            signal,
            // Asked again before every attempt: a captcha token is single-use.
            turnstileToken: faucetTokenRef.current ? () => faucetTokenRef.current?.() : undefined,
          });
          report({ status: "success", result, error: null });
          return result;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          // Aborted means the provider cut it short itself (the wallet left, or
          // the app unmounted): that is not a refusal worth showing.
          report(signal?.aborted ? IDLE_FAUCET : { status: "error", result: null, error: err });
          throw err;
        }
      })();
      // Whatever the outcome, the pair is then free to be asked for again.
      const settled = () => {
        if (faucetInFlight.current.get(key) === request) {
          faucetInFlight.current.delete(key);
        }
      };
      faucetInFlight.current.set(key, request);
      request.then(settled, settled);
      return request;
    },
    [faucetTokenRef],
  );

  const fund = useCallback(
    async (target?: Address): Promise<FaucetResult> => {
      const on = chainRef.current;
      const to = target ?? addressRef.current;
      if (!faucetUrl) {
        throw new Error("No faucetUrl configured on AvaKitProvider.");
      }
      if (!to) {
        throw new Error("Connect a wallet (or pass an address) before requesting funds.");
      }
      if (isMainnet(on)) {
        throw faucetOnMainnetError(on);
      }
      return runFaucet(faucetUrl, to, on, sessionRef.current);
    },
    [faucetUrl, runFaucet, chainRef, addressRef, sessionRef],
  );

  const resetFaucet = useCallback(() => {
    // A request still in flight keeps running, but no longer reports here.
    faucetRun.current += 1;
    setFaucet(IDLE_FAUCET);
  }, []);

  // Fund a freshly connected burner from the app's faucet, so the zero-config
  // wallet can transact with no manual faucet step. Once per address: after a
  // drip, or after finding the wallet already funded, it is not asked again.
  // Never on a mainnet, where there is nothing a faucet should send.
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
    const leaving = new AbortController();
    let concluded = false;

    void (async () => {
      // The burner key persists, so a reload reconnects the same wallet. If it
      // still holds funds, a request would spend a drip nobody needs, or come
      // back as "funded recently" and put an error on a page that is fine.
      const balance = await readBalance(address, chain, leaving.signal);
      if (leaving.signal.aborted) {
        return;
      }
      if (balance !== undefined && balance > 0n) {
        concluded = true;
        return;
      }
      // Empty, or unknown. Unknown asks as well: an empty wallet is the common
      // case, and the faucet's own limits cover the other one.
      try {
        await runFaucet(faucetUrl, address, chain, faucetSession(chain, address), leaving.signal);
        concluded = true;
      } catch {
        if (leaving.signal.aborted) {
          return;
        }
        // The shared state now shows the refusal, and fund() retries by hand.
        // Forget the address too, so that reconnecting asks again.
        concluded = true;
        fundedAddresses.current.delete(address);
      }
    })();

    return () => {
      if (!concluded) {
        // The wallet left (or the app unmounted) before this was settled. Stop
        // waiting, and let the next connection start over.
        fundedAddresses.current.delete(address);
        leaving.abort();
      }
    };
  }, [faucetUrl, status, address, activeAdapterId, chain, runFaucet]);

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

  // A state recorded for another account or chain reads as idle.
  const shown = faucet.session === session ? faucet : IDLE_FAUCET;
  const faucetEnabled = Boolean(faucetUrl) && !isMainnet(chain);
  const faucetValue = useMemo<FaucetContextValue>(
    () => ({
      status: shown.status,
      result: shown.result,
      error: shown.error,
      enabled: faucetEnabled,
      fund,
      reset: resetFaucet,
    }),
    [shown.status, shown.result, shown.error, faucetEnabled, fund, resetFaucet],
  );

  return (
    <AvaKitContext.Provider value={value}>
      <FaucetContext.Provider value={faucetValue}>{children}</FaucetContext.Provider>
    </AvaKitContext.Provider>
  );
}
