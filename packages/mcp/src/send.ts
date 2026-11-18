/**
 * Sending one transaction and finding out what became of it.
 *
 * Every step that can fail says so in terms of the question an agent has next —
 * was anything sent? — because the wrong answer to that is how a contract gets
 * deployed twice or a token minted twice:
 *
 *   • before the signature: nothing was sent, and the message says so;
 *   • a broadcast whose answer was lost: the node is asked whether it has the
 *     transaction (its hash is known before it goes out) rather than guessing;
 *   • sent but not yet mined: reported as exactly that, with the hash to check,
 *     and never re-sent from here.
 *
 * Sends are also taken one at a time. Two tool calls arriving together would
 * otherwise read the same nonce and the second would be rejected, or ask the
 * faucet twice for the same wallet.
 */

import { type AvaChain, getPublicClient } from "@avakit/core";
import {
  type Abi,
  type Address,
  BaseError,
  formatEther,
  formatUnits,
  type Hex,
  keccak256,
  type PublicClient,
  RpcRequestError,
  type TransactionReceipt,
  TransactionReceiptNotFoundError,
} from "viem";
import { reasonOf, revertReason, ToolError } from "./errors.js";
import { requestDrip } from "./faucet.js";
import { log } from "./log.js";
import { clock } from "./time.js";
import {
  BUILDER_HUB_FAUCET_URL,
  DEPLOYER_KEY_ENV,
  SESSION_NOTE,
  type Signer,
  type SignerSource,
  type UnsignedTransaction,
} from "./wallet.js";

/** How long a sent transaction is waited for before it is reported as still pending. */
export const RECEIPT_TIMEOUT_MS = 60_000;
/** How long the faucet's drip is waited for after the faucet accepted the request. */
export const FUNDS_WAIT_MS = 30_000;
/** The shorter wait when it is not known whether the faucet ever got the request. */
export const UNCERTAIN_FUNDS_WAIT_MS = 10_000;
const FUNDS_POLL_MS = 1_000;
/**
 * State right after a receipt: read up to six times over two seconds. Since the
 * Helicon upgrade a block is accepted before it is executed, so for a moment a
 * node can hand out the receipt of a creation and still answer "no code" at the
 * new address.
 */
const STATE_READS = 6;
const STATE_INTERVAL_MS = 400;

export interface Outgoing {
  /** What to call it in a message. */
  kind: "deployment" | "transaction";
  /** Absent for a contract creation. */
  to?: Address;
  data: Hex;
  value?: bigint;
  /** Lets a revert be reported by the contract's own error names. */
  abi?: Abi;
  /** Added to the "sent but not confirmed yet" message, e.g. where the contract will be. */
  whenPending?: (unsigned: UnsignedTransaction) => string;
}

export interface Sent {
  hash: Hex;
  receipt: TransactionReceipt;
  /** Present when the session wallet was funded for this transaction: what the faucet reported. */
  funded?: { amount?: string };
}

/** The part of a signing tool's result that says who signed. */
export interface SignedBy {
  signer: { address: Address; source: SignerSource };
  /** Only when the session test wallet signed: what it is, and whether the faucet just funded it. */
  note?: string;
}

export function signedBy(signer: Signer, sent: Sent): SignedBy {
  const who = { signer: { address: signer.address, source: signer.source } };
  if (signer.source !== "session") return who;
  if (!sent.funded) return { ...who, note: SESSION_NOTE };
  const amount = sent.funded.amount ? ` with ${sent.funded.amount} AVAX` : "";
  return { ...who, note: `${SESSION_NOTE} The AvaKit faucet funded it${amount} for this call.` };
}

/** Where to look a transaction up. Empty when the chain has no explorer. */
export function explorerTx(chain: AvaChain, hash: Hex): string {
  return chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : "";
}

/** AVAX with at most six decimals; `up` for an amount that has to be covered. */
function avax(wei: bigint, round: "down" | "up" = "down"): string {
  const unit = 10n ** 12n;
  const micro = wei / unit + (round === "up" && wei % unit > 0n ? 1n : 0n);
  // Too small to show in six places: show all of it rather than "0".
  return micro === 0n ? formatEther(wei) : formatUnits(micro, 6);
}

/** The same, for a sentence: the hash itself when there is no explorer to link to. */
function whereToLook(chain: AvaChain, hash: Hex): string {
  return explorerTx(chain, hash) || `transaction ${hash}`;
}

/** Run one read against the node; if it fails, say which one and that nothing went out. */
async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`Could not ${what}, so nothing was sent: ${reasonOf(error)}`);
  }
}

function waysForward(address: Address): string {
  return (
    `Two ways forward: set ${DEPLOYER_KEY_ENV} to your own funded Fuji key, or get test AVAX at ` +
    `${BUILDER_HUB_FAUCET_URL} (needs a free Builder Hub sign-in) for ${address} and call this ` +
    "tool again while the server is still running."
  );
}

/** Poll the balance until the drip shows up (enough or not) or the time is up. */
async function waitForFunds(
  client: PublicClient,
  address: Address,
  required: bigint,
  before: bigint,
  timeoutMs: number,
): Promise<bigint> {
  const started = clock.now();
  let balance = before;
  while (clock.now() - started < timeoutMs) {
    await clock.sleep(FUNDS_POLL_MS);
    try {
      balance = await client.getBalance({ address });
    } catch {
      continue;
    }
    if (balance >= required || balance > before) break;
  }
  return balance;
}

/**
 * Make sure the signer can pay `required` wei, or say exactly why it cannot.
 *
 * A key from the environment is the user's wallet: if it is short, they are
 * told by how much. The session test wallet is ours to fund, so it gets one
 * drip from the AvaKit faucet — and when the faucet says no, the answer is the
 * faucet's reason and the two things a person can do about it.
 */
async function ensureFunds(
  client: PublicClient,
  chain: AvaChain,
  signer: Signer,
  required: bigint,
  kind: Outgoing["kind"],
): Promise<Sent["funded"]> {
  const { address } = signer;
  const { symbol } = chain.nativeCurrency;
  const balance = await ask(`read the wallet's balance on ${chain.name}`, () =>
    client.getBalance({ address }),
  );
  if (balance >= required) return undefined;

  if (signer.source === "env") {
    const fundIt = `Fund it${chain.faucetUrl ? ` via ${chain.faucetUrl}` : ""}`;
    const doing = kind === "deployment" ? "deploying" : "sending";
    throw new ToolError(
      balance === 0n
        ? `${kind === "deployment" ? "Deployer" : "Wallet"} ${address} has no ${symbol} on ${chain.name}. ${fundIt} before ${doing}.`
        : `${kind === "deployment" ? "Deployer" : "Wallet"} ${address} has ${avax(balance)} ${symbol} on ${chain.name}, ` +
            `but this ${kind} needs about ${avax(required, "up")} ${symbol} at the current gas price. ` +
            `${fundIt} before ${doing}; nothing was sent.`,
    );
  }

  log(`asking the faucet for test AVAX for the session wallet ${address}.`);
  const drip = await requestDrip(address);
  const needs = `this ${kind} needs about ${avax(required, "up")} ${symbol}`;
  if (!drip.ok && !drip.maybeSent) {
    log(`the faucet did not fund ${address}: ${drip.reason}.`);
    throw new ToolError(
      `The session test wallet ${address} has ${avax(balance)} ${symbol} on ${chain.name} and ${needs}. ` +
        `The AvaKit faucet did not fund it: ${drip.reason}. Nothing was sent. ${waysForward(address)}`,
    );
  }

  const arrived = await waitForFunds(
    client,
    address,
    required,
    balance,
    drip.ok ? FUNDS_WAIT_MS : UNCERTAIN_FUNDS_WAIT_MS,
  );
  if (arrived >= required) {
    log(`the session wallet ${address} now holds ${avax(arrived)} ${symbol}.`);
    return drip.ok && drip.amount ? { amount: drip.amount } : {};
  }
  if (arrived > balance) {
    throw new ToolError(
      `The AvaKit faucet funded the session test wallet ${address}, but its ${avax(arrived)} ${symbol} ` +
        `does not cover it: ${needs} at the current gas price. Nothing was sent. ${waysForward(address)}`,
    );
  }
  if (!drip.ok) {
    throw new ToolError(
      `The session test wallet ${address} has ${avax(balance)} ${symbol} on ${chain.name} and ${needs}. ` +
        `The AvaKit faucet did not fund it: ${drip.reason}. Nothing was sent. ${waysForward(address)}`,
    );
  }
  throw new ToolError(
    `The AvaKit faucet accepted the request${drip.txHash ? ` (its transaction: ${drip.txHash})` : ""}, but ` +
      `the test AVAX had not reached the session test wallet ${address} after ` +
      `${FUNDS_WAIT_MS / 1000} seconds. Nothing was sent; calling this tool again in a moment will ` +
      `most likely work. ${waysForward(address)}`,
  );
}

/** The nonce of the last transaction each wallet got mined from here, by chain and address. */
const lastMined = new Map<string, number>();

/**
 * The next nonce: what the node says, but never one this process has already
 * seen mined. Right after a receipt a node can still report the old count.
 */
async function nextNonce(client: PublicClient, chain: AvaChain, address: Address): Promise<number> {
  const pending = await client.getTransactionCount({ address, blockTag: "pending" });
  const mined = lastMined.get(`${chain.id}:${address}`);
  return mined === undefined ? pending : Math.max(pending, mined + 1);
}

/** Whether the node has a transaction with this hash: yes, no, or it could not be asked. */
async function nodeHas(client: PublicClient, hash: Hex): Promise<boolean | undefined> {
  try {
    return (await client.request({ method: "eth_getTransactionByHash", params: [hash] })) !== null;
  } catch {
    return undefined;
  }
}

async function waitForReceipt(
  client: PublicClient,
  chain: AvaChain,
  hash: Hex,
  pending: () => string,
): Promise<TransactionReceipt> {
  const started = clock.now();
  let trouble = "";
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      // No receipt yet is the normal answer. Anything else is the node being
      // unreachable, which is no reason to stop waiting — but worth mentioning.
      trouble = error instanceof TransactionReceiptNotFoundError ? "" : reasonOf(error);
    }
    const waited = clock.now() - started;
    if (waited >= RECEIPT_TIMEOUT_MS) {
      throw new ToolError(
        `Transaction ${hash} was sent, but ${chain.name} had not confirmed it after ` +
          `${RECEIPT_TIMEOUT_MS / 1000} seconds${trouble ? ` (the node's last answer: ${trouble})` : ""}. ` +
          `It may still go through: check ${whereToLook(chain, hash)}, or read_chain with ` +
          `{ action: "txReceipt", hash: "${hash}" }, before sending anything again, so that it is ` +
          `not done twice.${pending()}`,
      );
    }
    await clock.sleep(waited < 5_000 ? 500 : 1_000);
  }
}

/** Wait, briefly, until the node's state has the transaction in it: its nonce is used up. */
async function settle(client: PublicClient, address: Address, nonce: number): Promise<void> {
  for (let read = 0; read < STATE_READS; read++) {
    if (read > 0) await clock.sleep(STATE_INTERVAL_MS);
    try {
      if ((await client.getTransactionCount({ address, blockTag: "latest" })) > nonce) return;
    } catch {
      return;
    }
  }
}

/**
 * Whether there is contract code at `address`, read up to six times over two
 * seconds before the answer is no (see STATE_READS).
 */
export async function codeExists(chain: AvaChain, address: Address): Promise<boolean> {
  const client = getPublicClient(chain);
  for (let read = 0; read < STATE_READS; read++) {
    if (read > 0) await clock.sleep(STATE_INTERVAL_MS);
    const code = await client.getCode({ address });
    if (code && code !== "0x") return true;
  }
  return false;
}

async function sendNow(chain: AvaChain, signer: Signer, outgoing: Outgoing): Promise<Sent> {
  const client = getPublicClient(chain);
  const { kind, to, data } = outgoing;
  const value = outgoing.value ?? 0n;
  const { address } = signer;

  // The node behind the URL has to be the chain the caller named. The id is
  // also signed into the transaction, so a signature for Fuji is not valid
  // anywhere else — this refuses earlier, and with a reason.
  const nodeChain = await ask(`reach ${chain.name} (${chain.rpcUrl})`, () => client.getChainId());
  if (nodeChain !== chain.id) {
    throw new ToolError(
      `The RPC for ${chain.name} answers as chain ${nodeChain}, not ${chain.id}. Nothing was signed.`,
    );
  }

  // From the address only, with no fee attached: an estimate that names a fee
  // is refused for a wallet that cannot pay it yet, and a new session wallet
  // cannot pay anything until the faucet has been asked.
  let gas: bigint;
  try {
    gas = await client.estimateGas({ account: address, to, data, value });
  } catch (error) {
    const reverted = revertReason(error, outgoing.abi);
    throw new ToolError(
      reverted
        ? `This ${kind} would revert on ${chain.name}, so nothing was sent. Reason: ${reverted}.`
        : `Could not estimate the gas for this ${kind} on ${chain.name}, so nothing was sent: ${reasonOf(error)}`,
    );
  }
  const fees = await ask(`read the current gas price on ${chain.name}`, () =>
    client.estimateFeesPerGas(),
  );

  // What the node will insist the wallet holds before it takes the transaction.
  const funded = await ensureFunds(client, chain, signer, gas * fees.maxFeePerGas + value, kind);

  const nonce = await ask(`read the wallet's nonce on ${chain.name}`, () =>
    nextNonce(client, chain, address),
  );
  const unsigned: UnsignedTransaction = {
    chainId: chain.id,
    nonce,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    ...(to ? { to } : {}),
    data,
    value,
  };
  const serialized = await signer.signTransaction(unsigned);
  // Known before it goes out, so "did the node get it?" has an answer later.
  const hash = keccak256(serialized);

  try {
    await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    // The node may have it all the same: the answer to a broadcast can be lost
    // on the way back, and a second copy of a transaction is answered "already
    // known". So ask, rather than report a failure for something that went out.
    const has = await nodeHas(client, hash);
    if (has !== true) {
      const said = reasonOf(error);
      // An error the node itself answered with means it did not take this
      // transaction — unless what it said is that it had seen it before, and
      // it could not then be asked. A connection that failed says nothing.
      const rejected =
        error instanceof BaseError &&
        error.walk((cause) => cause instanceof RpcRequestError) !== null &&
        !(has === undefined && /already known|nonce too low/i.test(said));
      throw new ToolError(
        rejected
          ? `${chain.name} rejected this ${kind}, so nothing was sent: ${said}`
          : `It is not certain whether this ${kind} went out: sending it to ${chain.name} failed (${said}). ` +
              `Its hash would be ${hash}: check ${whereToLook(chain, hash)} before trying again, ` +
              "so that it is not sent twice.",
      );
    }
  }

  const receipt = await waitForReceipt(
    client,
    chain,
    hash,
    () => outgoing.whenPending?.(unsigned) ?? "",
  );
  lastMined.set(`${chain.id}:${address}`, nonce);
  await settle(client, address, nonce);
  return { hash, receipt, ...(funded ? { funded } : {}) };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Sign and send one transaction, wait for it to be mined, and return its
 * receipt — whatever its status; the caller decides what a revert means.
 *
 * Throws a `ToolError` for everything else, worded so that it is clear whether
 * anything went out.
 */
export function send(chain: AvaChain, signer: Signer, outgoing: Outgoing): Promise<Sent> {
  const run = queue.then(() => sendNow(chain, signer, outgoing));
  queue = run.catch(() => undefined);
  return run;
}
