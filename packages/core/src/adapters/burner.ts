import {
  type Address,
  createWalletClient,
  type EIP1193Provider,
  type Hex,
  http,
  numberToHex,
} from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { type AvaChain, fuji, isMainnet } from "../chains.js";
import { toViemChain } from "../clients.js";
import { WalletConnectionError } from "../errors.js";
import type { WalletAdapter, WalletConnection } from "./types.js";

/**
 * Burner (temporary) wallet adapter — the zero-config default.
 *
 * Generates a throwaway private key in the browser, persists it to localStorage
 * so the same wallet survives reloads, and exposes it as an EIP-1193 provider so
 * the rest of AvaKit (getWalletClient, deploy, hooks) treats it like any other
 * wallet. No extension, no dashboard, no client ID — a stranger gets a working
 * wallet on first load. Bring-your-own-wallet (injected / social) stays the
 * upgrade path; the burner is what removes the first-run barrier.
 *
 * ⚠️  A burner key lives in localStorage, in the clear. It is for testnet demos
 *     and first-run UX only — never store meaningful funds in it, and never use
 *     it on mainnet without the user promoting to a real wallet.
 */

const DEFAULT_STORAGE_KEY = "avakit.burner.pk";
const PK_RE = /^0x[0-9a-fA-F]{64}$/;

export interface BurnerAdapterOptions {
  /** Chain the burner signs / sends on initially. Default: Fuji testnet. */
  chain?: AvaChain;
  /** Supply an existing key (e.g. to restore a specific wallet). Default: load persisted or generate. */
  privateKey?: Hex;
  /** Persist the key to localStorage so the same burner survives reloads. Default: true. */
  persist?: boolean;
  /** localStorage key used when persisting. Default: "avakit.burner.pk". */
  storageKey?: string;
  /** Display name for UI. */
  name?: string;
}

/** localStorage accessor that is safe on the server / in tests (guards `undefined`). */
function getStorage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredKey(storageKey: string): Hex | null {
  const value = getStorage()?.getItem(storageKey) ?? null;
  return value && PK_RE.test(value) ? (value as Hex) : null;
}

/** An EIP-1193 provider backed by a local key, plus an internal chain switch. */
type BurnerProvider = EIP1193Provider & { setChain(chain: AvaChain): void };

/**
 * Build an EIP-1193 provider that signs with a local account and forwards every
 * read method to the chain's RPC. Signing / accounts / chain-id are handled
 * locally; everything else (nonce, gas, estimate, calls, receipts) is proxied to
 * `chain.rpcUrl`, so viem's wallet client treats it like a normal wallet.
 */
function createBurnerProvider(account: PrivateKeyAccount, initialChain: AvaChain): BurnerProvider {
  let chain = initialChain;
  let wallet = createWalletClient({
    account,
    chain: toViemChain(chain),
    transport: http(chain.rpcUrl),
  });
  let rpcId = 0;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  async function forward(method: string, params: unknown[]): Promise<unknown> {
    const res = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) {
      throw new Error(json.error.message ?? `RPC error for ${method}`);
    }
    return json.result ?? null;
  }

  async function request(args: { method: string; params?: unknown[] | object }): Promise<unknown> {
    const p = (Array.isArray(args.params) ? args.params : []) as Array<
      Record<string, string | undefined> | string | undefined
    >;
    switch (args.method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_coinbase":
        return account.address;
      case "eth_chainId":
        return numberToHex(chain.id);
      case "net_version":
        return String(chain.id);
      // The burner follows the app's chain via setChain(); accept switch/add so
      // callers that fall back to EIP-1193 chain RPCs don't error.
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "personal_sign":
        return account.signMessage({ message: { raw: p[0] as Hex } });
      case "eth_sign":
        return account.signMessage({ message: { raw: p[1] as Hex } });
      case "eth_signTypedData_v4":
      case "eth_signTypedData":
        return account.signTypedData(
          JSON.parse(p[1] as string) as Parameters<typeof account.signTypedData>[0],
        );
      case "eth_sendTransaction": {
        const tx = (p[0] ?? {}) as Record<string, string | undefined>;
        return wallet.sendTransaction({
          account,
          to: (tx.to as Address | undefined) ?? undefined,
          value: tx.value != null ? BigInt(tx.value) : undefined,
          data: tx.data as Hex | undefined,
          gas: tx.gas != null ? BigInt(tx.gas) : undefined,
          nonce: tx.nonce != null ? Number(tx.nonce) : undefined,
          maxFeePerGas: tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas:
            tx.maxPriorityFeePerGas != null ? BigInt(tx.maxPriorityFeePerGas) : undefined,
          gasPrice: tx.gasPrice != null ? BigInt(tx.gasPrice) : undefined,
        } as never);
      }
      default:
        return forward(args.method, p);
    }
  }

  const provider = {
    request,
    on(event: string, cb: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return provider;
    },
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(cb);
      return provider;
    },
    setChain(next: AvaChain) {
      chain = next;
      wallet = createWalletClient({
        account,
        chain: toViemChain(next),
        transport: http(next.rpcUrl),
      });
      for (const cb of listeners.get("chainChanged") ?? []) {
        cb(numberToHex(next.id));
      }
    },
  };
  return provider as unknown as BurnerProvider;
}

/**
 * A zero-config, in-browser burner wallet. Always available; no keys or extension
 * required. Use it as the default so a new user can transact immediately, with a
 * real wallet (injected / social) offered as an upgrade.
 */
export function burnerAdapter(options: BurnerAdapterOptions = {}): WalletAdapter {
  const initialChain = options.chain ?? fuji;
  const persist = options.persist ?? true;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  let provider: BurnerProvider | null = null;
  let address: Address | null = null;

  return {
    id: "burner",
    name: options.name ?? "Temporary wallet (no setup)",

    isAvailable() {
      // Always works: no extension, dashboard, or client ID needed.
      return true;
    },

    async connect(): Promise<WalletConnection> {
      // The burner key lives in localStorage in the clear, so it must never
      // touch mainnet. Enforce testnet-only in code, not just docs. (audit A8)
      if (isMainnet(initialChain)) {
        throw new WalletConnectionError(
          `The temporary (burner) wallet is testnet-only and cannot connect on ${initialChain.name}. ` +
            "Connect a real wallet (injected / social) to use mainnet.",
        );
      }
      const key = options.privateKey ?? (persist ? readStoredKey(storageKey) : null);
      const pk = key ?? generatePrivateKey();
      if (persist && !options.privateKey && pk !== key) {
        getStorage()?.setItem(storageKey, pk);
      }
      let account: PrivateKeyAccount;
      try {
        account = privateKeyToAccount(pk);
      } catch {
        throw new WalletConnectionError("Invalid burner private key.");
      }
      provider = createBurnerProvider(account, initialChain);
      address = account.address;
      return { address, provider };
    },

    async disconnect() {
      // Keep the persisted key so reconnecting restores the same burner address.
      // Call clearBurner(storageKey) to forget it and generate a fresh wallet.
      provider = null;
      address = null;
    },

    getProvider() {
      return provider;
    },

    async switchChain(chain: AvaChain) {
      if (isMainnet(chain)) {
        throw new WalletConnectionError(
          `The temporary (burner) wallet is testnet-only and cannot switch to ${chain.name}. ` +
            "Connect a real wallet to use mainnet.",
        );
      }
      provider?.setChain(chain);
    },
  };
}

/** Delete the persisted burner key so the next connect() generates a fresh wallet. */
export function clearBurner(storageKey: string = DEFAULT_STORAGE_KEY): void {
  getStorage()?.removeItem(storageKey);
}
