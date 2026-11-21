import {
  type Address,
  createWalletClient,
  type EIP1193Provider,
  type Hex,
  HttpRequestError,
  numberToHex,
  TimeoutError,
  type Transport,
} from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import {
  type AvaChain,
  fuji,
  isMainnet,
  KNOWN_MAINNET_CHAIN_IDS,
  rpcEndpoints,
} from "../chains.js";
import { toViemChain, transportFor } from "../clients.js";
import { missingTestnetFlagHint, WalletConnectionError } from "../errors.js";
import type { AvaChainSwitcher } from "../network.js";
import { shownEndpoint } from "../rpc-failover.js";
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
  /**
   * Persist the key to localStorage so the same burner survives reloads.
   * Default: true. With `false` the key is kept in memory only: this adapter
   * keeps its wallet across reconnects, and a reload starts a fresh one.
   */
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

/**
 * The burner key lives in localStorage in the clear, so it must never touch a
 * mainnet. Enforced in code, not just docs, on every route into the wallet:
 * connecting, the adapter's switchChain, and the provider's own chain switch.
 * (audit A8)
 */
function assertTestnet(chain: AvaChain, action: "connect on" | "switch to"): void {
  if (isMainnet(chain)) {
    throw new WalletConnectionError(
      `${missingTestnetFlagHint(chain)}The temporary (burner) wallet is testnet-only and cannot ` +
        `${action} ${chain.name}. Connect a real wallet (injected / social) to use mainnet.`,
    );
  }
}

/**
 * How every refusal on the send path opens, so that the verdict survives a UI
 * that shows only the start of an error.
 */
const NOTHING_SENT = "Nothing was signed or sent: ";

/** A chain id as a node gives it: a hex quantity and nothing else. */
const HEX_QUANTITY_RE = /^0x[0-9a-fA-F]+$/;

function isKnownMainnetId(id: bigint): boolean {
  return id <= BigInt(Number.MAX_SAFE_INTEGER) && KNOWN_MAINNET_CHAIN_IDS.has(Number(id));
}

/**
 * The refusal for a transaction that would not be for the chain the definition
 * names. `source` says who named the other chain; `found` is that chain's id,
 * or undefined when none was named at all. `field` is the part of the
 * definition to fix: `rpcUrl`, or `rpcUrls` when a fallback endpoint named it.
 *
 * The wording stays clear of "wrong network" and "chain mismatch": apps map
 * those to "switch your wallet", and switching cannot repair a definition whose
 * id and RPC disagree.
 */
function otherChainError(
  chain: AvaChain,
  source: string,
  found: bigint | undefined,
  field: "rpcUrl" | "rpcUrls" = "rpcUrl",
): WalletConnectionError {
  const start =
    `${NOTHING_SENT}${chain.name} is defined as chain ${chain.id}, but ${source} ` +
    (found === undefined ? "no chain" : `chain ${found}`);
  const point =
    field === "rpcUrl"
      ? `Point the definition's rpcUrl at a chain ${chain.id} node`
      : `Point every URL in the definition's rpcUrls at a chain ${chain.id} node`;
  return new WalletConnectionError(
    found !== undefined && isKnownMainnetId(found)
      ? `${start}, which is a mainnet. The temporary (burner) wallet is testnet-only. ${point}, ` +
          "or connect a real wallet (injected / social) to use mainnet."
      : `${start}. The temporary (burner) wallet signs only for the chain its definition names. ` +
          `Make the definition's id and ${field} describe the same chain, then try again.`,
  );
}

/**
 * Why one endpoint's node did not say which chain it serves. Not a refusal:
 * the chain's next endpoint may still answer. It never leaves the provider;
 * `unconfirmedNodeError` reports it once no endpoint has answered.
 */
class UnconfirmedNode extends Error {
  constructor(
    readonly why: string,
    cause?: unknown,
  ) {
    super(why, cause === undefined ? undefined : { cause });
  }
}

/** `text` as a sentence of its own: ends with a full stop unless it ends a sentence already. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * One of `chain`'s RPC URLs as a refusal names it: the entry of the
 * definition's `rpcUrls` to look at, and the endpoint's origin. Never the
 * whole URL, which can hold a password or an API key, while the refusal is
 * shown to the user as it stands (`humanizeError` passes it on) and logged.
 */
function rpcUrlsEntry(chain: AvaChain, url: string): string {
  const index = Array.isArray(chain.rpcUrls) ? chain.rpcUrls.indexOf(url) : -1;
  return index === -1 ? shownEndpoint(url) : `rpcUrls[${index}] (${shownEndpoint(url)})`;
}

/** The refusal for a chain none of whose endpoints said which chain it serves. */
function unconfirmedNodeError(
  chain: AvaChain,
  unanswered: readonly { url: string; failure: UnconfirmedNode }[],
): WalletConnectionError {
  const [only, ...others] = unanswered;
  if (only && others.length === 0) {
    const { why, cause } = only.failure;
    return new WalletConnectionError(
      `${NOTHING_SENT}the temporary (burner) wallet could not confirm that the node at ` +
        `${chain.name}'s rpcUrl serves chain ${chain.id}. ${why} Check the RPC and try again.`,
      cause === undefined ? undefined : { cause },
    );
  }
  const each = unanswered.map(
    ({ url, failure }) =>
      `At ${rpcUrlsEntry(chain, url)}, ${sentence(failure.why.replace(/^I/, "i"))}`,
  );
  return new WalletConnectionError(
    `${NOTHING_SENT}the temporary (burner) wallet could not confirm that any of ` +
      `${chain.name}'s ${unanswered.length} RPC URLs serves chain ${chain.id}. ` +
      `${each.join(" ")} Check the RPCs and try again.`,
    only?.failure.cause === undefined ? undefined : { cause: only.failure.cause },
  );
}

/** One sentence for why a request failed. viem's short message leaves the RPC URL out. */
function reason(cause: unknown): string {
  if (typeof cause === "object" && cause !== null) {
    const { shortMessage, message } = cause as { shortMessage?: unknown; message?: unknown };
    if (typeof shortMessage === "string") return shortMessage;
    if (typeof message === "string") return message;
  }
  return String(cause);
}

/** The burner's own refusal, when `error` is one or wraps one. Bounded, in case a cause chain loops. */
function refusalIn(error: unknown): WalletConnectionError | undefined {
  let link = error;
  for (let depth = 0; typeof link === "object" && link !== null && depth < 10; depth += 1) {
    if (link instanceof WalletConnectionError) return link;
    link = (link as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Whether `error` says that a node did not answer (a network failure, a
 * timeout, an HTTP error status), as opposed to answering with a JSON-RPC
 * error such as a revert. Bounded like `refusalIn`.
 */
function unanswered(error: unknown): boolean {
  let step = error;
  for (let depth = 0; typeof step === "object" && step !== null && depth < 10; depth += 1) {
    if (step instanceof HttpRequestError || step instanceof TimeoutError) return true;
    step = (step as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * An EIP-1193 provider backed by a local key. `avakitSwitchChain` is its real
 * chain switch: unlike `wallet_switchEthereumChain` it receives the whole
 * `AvaChain`, so it knows which RPC to talk to and can refuse a mainnet.
 * `ensureChain()` calls it, which is what makes "await ensureChain, then send"
 * work with a burner.
 */
type BurnerProvider = EIP1193Provider & AvaChainSwitcher;

/**
 * Build an EIP-1193 provider that signs with a local account and forwards every
 * read method to the chain's RPC. Signing / accounts / chain-id are handled
 * locally; everything else (nonce, gas, estimate, calls, receipts) is proxied to
 * the chain's RPC endpoints, so viem's wallet client treats it like a normal
 * wallet.
 *
 * A transaction is only ever signed for the chain the definition names. The id
 * and the `testnet` flag are the definition's own claim, and its RPC URLs can
 * contradict them: a definition labelled Fuji whose `rpcUrl` points at a mainnet
 * node would otherwise have the burner transact on that mainnet. Two things
 * stand in the way, and neither touches `connect()`, which stays offline:
 *
 * 1. Before a send, the node at the endpoint the send will go through is asked
 *    which chain it serves, and the send is refused unless it answers with the
 *    definition's id.
 * 2. The signer itself refuses a transaction whose chain id is not the
 *    definition's, whoever prepared it. A node that lies to the first check
 *    still gets nothing but a signature bound to the definition's id, which
 *    any other chain rejects (EIP-155).
 *
 * A chain with several endpoints (`rpcUrls`) does not fail over within a send,
 * as viem's fallback transport would: that picks an endpoint per request, so
 * the node that answered the check need not be the node that gets the
 * transaction. Each send goes through one endpoint, the first in the chain's
 * order whose node has confirmed the chain, and the burner keeps to it. When a
 * send finds that node gone, the next send asks again and moves on.
 *
 * Message and typed-data signatures are not transactions and are not bound to
 * the node's chain.
 */
function createBurnerProvider(account: PrivateKeyAccount, initialChain: AvaChain): BurnerProvider {
  /** The burner's account, able to sign transactions for `target` and for no other chain. */
  function signerFor(target: AvaChain): PrivateKeyAccount {
    const signTransaction = (async (
      transaction: { chainId?: number },
      options?: Parameters<PrivateKeyAccount["signTransaction"]>[1],
    ) => {
      if (transaction.chainId !== target.id) {
        throw otherChainError(
          target,
          "the transaction handed to the signer names",
          typeof transaction.chainId === "number" ? BigInt(transaction.chainId) : undefined,
        );
      }
      return account.signTransaction(transaction as never, options);
    }) as PrivateKeyAccount["signTransaction"];
    return { ...account, signTransaction };
  }

  /** A wallet client that signs for `target` and talks to the node at `url` and no other. */
  function walletAt(target: AvaChain, url: string) {
    return createWalletClient({
      account: signerFor(target),
      chain: toViemChain(target),
      transport: transportFor([url]),
    });
  }

  type Wallet = ReturnType<typeof walletAt>;

  /**
   * What the burner knows about the chain it is on: its endpoints, which of
   * them have said that their node serves it, and a wallet client for each one
   * a send has gone through.
   */
  interface ChainLink {
    readonly chain: AvaChain;
    readonly endpoints: readonly string[];
    /**
     * Node checks by endpoint: running, or passed. One that passed stays, so
     * the question costs one request per chain and not one per transaction.
     * One that failed is dropped, so the next send asks again. A switch to
     * another chain, or to other endpoints for this one, starts with none.
     */
    readonly checks: Map<string, Promise<void>>;
    /** Wallet clients by endpoint, made when a send first goes through one. */
    readonly wallets: Map<string, Wallet>;
    /**
     * Reads forwarded to the chain: one pass over its endpoints in order, each
     * request limited like any other, moving on only from an endpoint that
     * fails the request (see `getRpcTransport`). No retries of the burner's
     * own: the app's client retries what it sends through this provider
     * (viem's custom transport does), and a second layer would multiply them.
     */
    readonly reads: ReturnType<Transport>;
  }

  function linkTo(next: AvaChain, previous?: ChainLink): ChainLink {
    const endpoints = rpcEndpoints(next);
    const sameNodes =
      previous !== undefined &&
      previous.chain.id === next.id &&
      previous.endpoints.length === endpoints.length &&
      previous.endpoints.every((url, index) => url === endpoints[index]);
    return {
      chain: next,
      endpoints,
      // Another chain, or another node for this one, has to answer for itself.
      // A switch to the chain the wallet is already on (ensureChain makes one
      // before every send) keeps the answers.
      checks: sameNodes ? previous.checks : new Map(),
      wallets: new Map(),
      reads: transportFor(endpoints, 0)({ chain: toViemChain(next) }),
    };
  }

  let link = linkTo(initialChain);
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  /** Ask the node at `url` which chain it serves; reject unless it is the link's chain. */
  async function askNode(on: ChainLink, url: string): Promise<void> {
    const { chain: target, endpoints } = on;
    // With one endpoint, the question is retried like any other call. With
    // several, the next endpoint is the retry.
    const node = transportFor(
      [url],
      endpoints.length === 1 ? undefined : 0,
    )({
      chain: toViemChain(target),
    });
    let answer: unknown;
    try {
      answer = await node.request({ method: "eth_chainId" });
    } catch (cause) {
      throw new UnconfirmedNode(`Its eth_chainId request failed: ${reason(cause)}`, cause);
    }
    // Anything but a hex quantity is no answer, and no answer is never a match.
    if (typeof answer !== "string" || !HEX_QUANTITY_RE.test(answer)) {
      const shown = (JSON.stringify(answer) ?? String(answer)).slice(0, 80);
      throw new UnconfirmedNode(`It answered eth_chainId with ${shown}, which is not a chain id.`);
    }
    const reported = BigInt(answer);
    if (reported !== BigInt(target.id)) {
      throw url === endpoints[0]
        ? otherChainError(target, "the node at its rpcUrl reports", reported)
        : otherChainError(
            target,
            `the node at ${rpcUrlsEntry(target, url)} reports`,
            reported,
            "rpcUrls",
          );
    }
  }

  /** The node check for `url` on `on`: the one remembered, or a new one. */
  function checkNode(on: ChainLink, url: string): Promise<void> {
    const known = on.checks.get(url);
    if (known) {
      return known;
    }
    const check = askNode(on, url);
    on.checks.set(url, check);
    check.catch(() => {
      // Only this check is dropped: by now a later send may have started another.
      if (on.checks.get(url) === check) {
        on.checks.delete(url);
      }
    });
    return check;
  }

  /**
   * The endpoint a send goes through: the first, in the chain's order, whose
   * node confirms the chain, together with that confirmation. Endpoints that
   * have already confirmed it are tried first, so the wallet keeps to a node
   * that answers rather than waiting again on one that stopped. A node that
   * names another chain refuses the send outright; one that cannot say passes
   * the question to the next endpoint.
   */
  async function endpointFor(on: ChainLink): Promise<{ url: string; check: Promise<void> }> {
    const confirmed = on.endpoints.filter((url) => on.checks.has(url));
    const rest = on.endpoints.filter((url) => !on.checks.has(url));
    const unconfirmed: { url: string; failure: UnconfirmedNode }[] = [];
    for (const url of [...confirmed, ...rest]) {
      const check = checkNode(on, url);
      try {
        await check;
        return { url, check };
      } catch (error) {
        if (!(error instanceof UnconfirmedNode)) {
          throw error;
        }
        unconfirmed.push({ url, failure: error });
      }
    }
    throw unconfirmedNodeError(on.chain, unconfirmed);
  }

  /** The link's wallet client for `url`, made on first use and kept. */
  function walletFor(on: ChainLink, url: string): Wallet {
    let wallet = on.wallets.get(url);
    if (!wallet) {
      wallet = walletAt(on.chain, url);
      on.wallets.set(url, wallet);
    }
    return wallet;
  }

  async function forward(method: string, params: unknown[]): Promise<unknown> {
    const result: unknown = await link.reads.request({ method, params } as never);
    return result ?? null;
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
      // Answered from the definition, not by the node: callers ask this to learn
      // where the wallet thinks it is. What the node really serves is checked
      // before a transaction is signed.
      case "eth_chainId":
        return numberToHex(link.chain.id);
      case "net_version":
        return String(link.chain.id);
      // These standard requests cannot move the burner: they carry a chain id
      // (and, for add, an RPC URL) but not the testnet flag the burner enforces.
      // They are accepted as no-ops so generic EIP-1193 callers don't error; the
      // real switch is avakitSwitchChain() below, which ensureChain() and the
      // adapter's switchChain() both go through.
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
        // Taken before the first await: a switch while this send is under way
        // must not move it to another chain halfway through.
        const sending = link;
        const { url, check } = await endpointFor(sending);
        // Bound to the endpoint whose node just confirmed the chain: every
        // request of this send, the transaction itself included, goes there.
        const client = walletFor(sending, url);
        try {
          // Signed by the client's own account, which is bound to its chain.
          return await client.sendTransaction({
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
        } catch (error) {
          // viem wraps what the signer throws; hand a refusal back as it was raised.
          const refusal = refusalIn(error);
          if (refusal) {
            throw refusal;
          }
          // The node stopped answering. Forget that it confirmed the chain, so
          // the next send asks it again and moves on to the chain's next
          // endpoint if it is still gone. Never resent from here: the
          // transaction may have reached the node before its answer was lost.
          // With a single endpoint there is nowhere to move on to.
          if (
            sending.endpoints.length > 1 &&
            unanswered(error) &&
            sending.checks.get(url) === check
          ) {
            sending.checks.delete(url);
          }
          throw error;
        }
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
    async avakitSwitchChain(next: AvaChain) {
      assertTestnet(next, "switch to");
      const changed = next.id !== link.chain.id;
      link = linkTo(next, link);
      // EIP-1193: announce a chain change, not a repeat of the current chain.
      if (changed) {
        for (const cb of listeners.get("chainChanged") ?? []) {
          cb(numberToHex(next.id));
        }
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
  // With `persist: false` the generated key lives here and nowhere else, so
  // reconnecting through this adapter restores the same wallet instead of
  // stranding whatever the first one was funded with.
  let memoryKey: Hex | null = null;

  return {
    id: "burner",
    name: options.name ?? "Temporary wallet (no setup)",

    isAvailable() {
      // Always works: no extension, dashboard, or client ID needed.
      return true;
    },

    async connect(): Promise<WalletConnection> {
      assertTestnet(initialChain, "connect on");
      const key = options.privateKey ?? (persist ? readStoredKey(storageKey) : memoryKey);
      const pk = key ?? generatePrivateKey();
      if (!options.privateKey && pk !== key) {
        if (persist) {
          getStorage()?.setItem(storageKey, pk);
        } else {
          memoryKey = pk;
        }
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
      // Keep the key (persisted, or in memory with `persist: false`) so
      // reconnecting restores the same burner address. Call
      // clearBurner(storageKey) to forget a persisted key and generate a fresh
      // wallet; a key held in memory goes away with the adapter.
      provider = null;
      address = null;
    },

    getProvider() {
      return provider;
    },

    async switchChain(chain: AvaChain) {
      // Checked here as well, so a mainnet is refused even before connect(),
      // while there is no provider to ask yet.
      assertTestnet(chain, "switch to");
      await provider?.avakitSwitchChain(chain);
    },
  };
}

/** Delete the persisted burner key so the next connect() generates a fresh wallet. */
export function clearBurner(storageKey: string = DEFAULT_STORAGE_KEY): void {
  getStorage()?.removeItem(storageKey);
}
