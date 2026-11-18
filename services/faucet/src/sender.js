import { createPublicClient, defineChain, http, keccak256, RpcRequestError } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Testnet allowlist — chainId → RPC. Anything not listed is refused. */
export const CHAINS = {
  43113: { name: "Avalanche Fuji", rpc: "https://api.avax-test.network/ext/bc/C/rpc" },
};
export const DEFAULT_CHAIN_ID = 43113;

/** The faucet account cannot cover a drip right now. */
export class FaucetEmptyError extends Error {
  name = "FaucetEmptyError";
}

/**
 * The recipient is a contract the faucet does not pay: one that turns a plain
 * transfer down, or that costs more than MAX_DRIP_GAS to pay.
 */
export class FaucetRecipientError extends Error {
  name = "FaucetRecipientError";
}

/** The Worker is set up wrong. `message` never carries a secret and may be shown to a caller. */
export class FaucetConfigError extends Error {
  name = "FaucetConfigError";
}

/**
 * How long a nonce we used may go uncounted by the node before we stop
 * believing in it. Fuji produces a block every second or two, so a transaction
 * that is still missing from `eth_getTransactionCount` after this was dropped.
 */
export const NONCE_SETTLE_MS = 15_000;

/** Attempts at one drip before giving up on finding a free nonce. */
export const MAX_SEND_ATTEMPTS = 4;

/**
 * The most gas a drip may use. Paying a wallet takes 21,000 and a
 * smart-contract wallet a few thousand more; a recipient that needs more than
 * this is a contract doing work in its receive(), at the faucet's expense — the
 * drip's value is fixed, but the gas it burns would be the recipient's choice.
 */
export const MAX_DRIP_GAS = 100_000n;

/**
 * When a send gets no answer, the node may hold the transaction all the same.
 * It is then looked up by its hash: this is the wait before each look, so four
 * looks over two seconds — long enough for a node that was still busy with the
 * send, or one of a pool that hears of it a moment later.
 */
export const SENT_LOOKUP_WAITS_MS = [0, 500, 500, 1000];
/** The looks together may not take longer than this, however slow the RPC is. */
const SENT_LOOKUP_DEADLINE_MS = 5000;

/** What geth (and Avalanche's coreth) says when a nonce is already spoken for. */
const NONCE_TAKEN = /nonce too low|replacement transaction underpriced/;
/** …and when it already holds this exact signed transaction. */
const ALREADY_KNOWN = /already known|transaction already imported/;
const INSUFFICIENT_FUNDS = /insufficient funds|exceeds transaction sender account balance/;
/** …and when the recipient's own code refused the transfer. */
const REVERTED = /execution reverted/;

/**
 * The faucet account and an RPC client for an allowlisted chain, or null for
 * any other chain. Throws FaucetConfigError if the key is unusable.
 */
export function connect(chainId, env) {
  if (!Object.hasOwn(CHAINS, chainId)) return null;
  const cfg = CHAINS[chainId];
  const rpcUrl = env.FAUCET_FUJI_RPC || cfg.rpc;
  const chain = defineChain({
    id: chainId,
    name: cfg.name,
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  let account;
  try {
    account = privateKeyToAccount(env.AVAKIT_FAUCET_KEY);
  } catch {
    // Deliberately not rethrown or logged: the cause may quote the value.
    throw new FaucetConfigError("Faucet key is not a valid private key.");
  }

  return { account, rpcUrl, client: createPublicClient({ chain, transport: http(rpcUrl) }) };
}

/**
 * Sends drips from one account, one at a time.
 *
 * Every transaction from an account needs the next nonce, and two requests that
 * ask the node for it at the same moment get the same answer — the second
 * transaction is then rejected (or silently replaced). So broadcasts go through
 * a queue: the nonce is read, signed and sent before the next one is read. This
 * only holds because a single Durable Object owns the account.
 */
export class DripSender {
  #client;
  #account;
  /** Only ever used to redact it from what is logged. */
  #rpcUrl;
  /** Tail of the send queue. */
  #queue = Promise.resolve();
  /** nonce → when we last saw it used, for nonces the node has not counted yet. */
  #used = new Map();

  constructor({ client, account, rpcUrl }) {
    this.#client = client;
    this.#account = account;
    this.#rpcUrl = rpcUrl;
  }

  /**
   * Everything a drip needs except its nonce: fees, the gas limit, and proof the
   * balance covers it. None of that depends on the queue, so concurrent
   * requests prepare in parallel and only the broadcast is serialised.
   *
   * Throws FaucetEmptyError if the account cannot pay for the drip, and
   * FaucetRecipientError if the recipient is a contract the faucet does not pay.
   */
  async prepare({ to, value }) {
    let balance;
    let request;
    try {
      [balance, request] = await Promise.all([
        this.#client.getBalance({ address: this.#account.address }),
        this.#client.prepareTransactionRequest({
          account: this.#account,
          to,
          value,
          parameters: ["chainId", "fees", "gas", "type"],
        }),
      ]);
    } catch (e) {
      const said = nodeSaid(e);
      // A plain transfer only reverts when the recipient is a contract that
      // refuses it. Checked first, because a contract words its own revert
      // reason and could make it read like an empty faucet.
      if (REVERTED.test(said)) throw new FaucetRecipientError();
      // Estimating gas for a transfer the account cannot afford fails this way.
      if (INSUFFICIENT_FUNDS.test(said)) throw new FaucetEmptyError();
      throw e;
    }

    // A node that fills the transaction in itself also names its own chain. If
    // that is not the allowlisted one, the RPC override points somewhere else.
    const chainId = this.#client.chain.id;
    if (request.chainId !== chainId) {
      throw new FaucetConfigError(
        `The faucet's RPC answers for chain ${request.chainId}, not ${chainId}.`,
      );
    }

    // The gas limit is the node's estimate for the caller's chosen recipient,
    // and it is signed as it stands — so it is capped here.
    if (request.gas > MAX_DRIP_GAS) throw new FaucetRecipientError();

    const fee = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
    if (balance < value + fee) throw new FaucetEmptyError();
    return request;
  }

  /** Sign and send a prepared drip. Resolves to the transaction hash. */
  broadcast(request) {
    const sent = this.#queue.then(() => this.#broadcast(request));
    // A failed send must not poison the queue for the drips behind it.
    this.#queue = sent.catch(() => {});
    return sent;
  }

  async #broadcast(request) {
    // The chain id is set here, last, from the allowlist — never from anything
    // an RPC returned — so the key cannot sign for a chain with real funds.
    const chainId = this.#client.chain.id;
    let nonce = await this.#nextNonce();

    for (let attempt = 1; ; attempt += 1) {
      const serializedTransaction = await this.#account.signTransaction({
        ...request,
        chainId,
        nonce,
      });
      const hash = keccak256(serializedTransaction);
      try {
        await this.#client.sendRawTransaction({ serializedTransaction });
      } catch (e) {
        const said = nodeSaid(e);
        if (INSUFFICIENT_FUNDS.test(said)) throw new FaucetEmptyError();

        if (NONCE_TAKEN.test(said) && attempt < MAX_SEND_ATTEMPTS) {
          // Something already holds this nonce — an earlier drip the node we
          // asked had not counted yet, or another user of the key. Move past it.
          this.#used.set(nonce, Date.now());
          nonce = Math.max(nonce + 1, await this.#nextNonce());
          continue;
        }

        // "already known" means the node holds this exact transaction, so it is
        // sent. Any other JSON-RPC error is the node refusing it: a real failure.
        if (!ALREADY_KNOWN.test(said)) {
          if (rejectedByNode(e)) throw e;

          // What is left is no answer at all — an HTTP error from something in
          // front of the node, or a timeout. That says nothing about the
          // transaction, which the node may have taken before the answer was
          // lost. We signed it, so we know its hash: ask.
          const found = await this.#landed(hash);
          console.warn(
            JSON.stringify({
              message: "send answer lost",
              txHash: hash,
              found,
              ...describeError(e, this.#rpcUrl),
            }),
          );
          if (!found) throw e;
        }
      }

      this.#used.set(nonce, Date.now());
      return hash;
    }
  }

  /**
   * Whether the node holds the transaction with this hash, pending or mined.
   * Asked a few times, because the node that answers may not be the one that
   * took it. A look that fails counts as "not found": if the RPC stays out of
   * reach, the drip is reported as failed.
   */
  async #landed(hash) {
    const deadline = AbortSignal.timeout(SENT_LOOKUP_DEADLINE_MS);
    for (const wait of SENT_LOOKUP_WAITS_MS) {
      if (wait > 0) await sleep(wait);
      if (deadline.aborted) break;
      try {
        const transaction = await this.#client.request(
          { method: "eth_getTransactionByHash", params: [hash] },
          { retryCount: 0, signal: deadline },
        );
        if (transaction) return true;
      } catch {
        // This look got no answer either. The next one may.
      }
    }
    return false;
  }

  /**
   * The nonce for the next transaction.
   *
   * Normally that is the node's pending count. But the public RPC is a pool of
   * nodes, and the one answering may not have heard of a drip another accepted
   * a moment ago — so nonces we used within NONCE_SETTLE_MS are skipped. One
   * the node still has not counted after that was dropped, and is used again
   * so the transactions behind it are not stuck forever.
   */
  async #nextNonce() {
    const count = await this.#client.getTransactionCount({
      address: this.#account.address,
      blockTag: "pending",
    });
    for (const nonce of this.#used.keys()) {
      if (nonce < count) this.#used.delete(nonce);
    }

    const now = Date.now();
    let nonce = count;
    while (now - (this.#used.get(nonce) ?? Number.NEGATIVE_INFINITY) < NONCE_SETTLE_MS) {
      nonce += 1;
    }
    return nonce;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when the node itself turned the request down with a JSON-RPC error, as
 * opposed to the request getting no answer (an HTTP error, a timeout).
 */
function rejectedByNode(error) {
  for (let e = error; e; e = e.cause) {
    if (e instanceof RpcRequestError) return true;
  }
  return false;
}

/** The node's own words for why a request failed, lower-cased ("" if it said nothing). */
function nodeSaid(error) {
  for (let e = error; e; e = e.cause) {
    if (typeof e.details === "string" && e.details) return e.details.toLowerCase();
  }
  return "";
}

/**
 * A log-safe summary of an error. viem prints the RPC URL in its messages and
 * that URL may carry a provider API key, so it is stripped from everything.
 */
export function describeError(error, rpcUrl) {
  if (!(error instanceof Error)) return { error: "unknown" };

  const secrets = new Set();
  if (rpcUrl) {
    secrets.add(rpcUrl);
    try {
      const url = new URL(rpcUrl);
      const parts = [
        ...url.pathname.split("/"),
        ...url.searchParams.values(),
        url.username,
        url.password,
      ];
      // A key is long; "ext", "bc" and "rpc" are not.
      for (const part of parts) if (part.length >= 16) secrets.add(part);
    } catch {
      // Not a URL: there is nothing more to take apart.
    }
  }
  const redact = (text) => {
    let safe = String(text);
    for (const secret of secrets) safe = safe.replaceAll(secret, "[redacted]");
    return safe;
  };

  return {
    error: error.name,
    detail: redact(error.shortMessage ?? error.message),
    ...(typeof error.details === "string" && error.details ? { node: redact(error.details) } : {}),
  };
}
