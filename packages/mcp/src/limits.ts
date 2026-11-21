/**
 * What the signing tools may do on their own: which contracts `write_contract`
 * calls, and how much AVAX one `deploy_contract` or `write_contract` call sends.
 *
 * An agent decides what to call, and an agent can be steered by what it reads:
 * a README, an issue, a web page. Without a limit, a prompt-injected agent could
 * call any contract on Fuji with the wallet this server signs with, and send it
 * whatever AVAX a key of the user's holds. Two limits come from the server's
 * environment, which a tool call cannot change:
 *
 *   • `write_contract` calls a contract only when this server deployed it in
 *     this session, on that chain, or when AVAKIT_WRITE_ALLOWLIST lists its
 *     address. AVAKIT_WRITE_ALLOWLIST=* turns the check off.
 *   • one call sends at most AVAKIT_MAX_VALUE AVAX with its transaction, 0.1
 *     when the variable is not set. Gas is paid on top, as always.
 *
 * Both are checked once the call itself is understood and before anything is
 * asked of the chain or the faucet, and again by the signer at the moment of
 * signing (wallet.ts), so a path that skips the first check still gets no
 * signature. A limit set to something that cannot be read refuses every call it
 * governs rather than guess what was meant.
 *
 * Files are not a source of trust here. A project could keep a record of the
 * contracts it deployed (the templates keep theirs in the browser's storage),
 * but the agent this guards against can write files too, and an address it
 * wrote into one would be as good as allowed. The deployments this process
 * signed and the environment it was started with are the two things a tool
 * call cannot add to.
 *
 * This is a floor, not a policy engine: there is no limit per day, no list of
 * the functions that may be called, and no confirmation by a person. Both
 * limits hold per call: repeated calls are not counted, and a contract this
 * process deployed can pass on the calls and the AVAX it receives.
 */

import type { AvaChain } from "@avakit/core";
import { type Address, formatEther, getAddress, isAddress, parseEther } from "viem";
import { ToolError } from "./errors.js";
import { ADDRESS_RE } from "./guards.js";

/** Comma-separated addresses `write_contract` may call besides this session's deployments, or `*`. */
export const WRITE_ALLOWLIST_ENV = "AVAKIT_WRITE_ALLOWLIST";
/** The most AVAX one deploy_contract or write_contract call may send, as a decimal number. */
export const MAX_VALUE_ENV = "AVAKIT_MAX_VALUE";
/** The limit while AVAKIT_MAX_VALUE is not set, in AVAX. */
export const DEFAULT_MAX_VALUE = "0.1";

/** How every refusal here ends: the question an agent has next, answered. */
const NOTHING_SENT = "Nothing was signed or sent.";

/** Lowercase addresses of the contracts this process deployed, by chain id. */
const deployed = new Map<number, Set<string>>();

/**
 * Remember a contract this process deployed, so `write_contract` may call it on
 * that chain for as long as the process runs. deploy.ts records the address as
 * soon as the creation is signed: it is derived from the signer and the nonce,
 * so whatever ends up there was created by this signer's transaction, and a
 * deployment that was still pending, or whose code could not be read back, can
 * be called once it is there.
 */
export function recordDeployment(chainId: number, address: Address): void {
  let addresses = deployed.get(chainId);
  if (!addresses) {
    addresses = new Set();
    deployed.set(chainId, addresses);
  }
  addresses.add(address.toLowerCase());
}

/** Whether this process deployed the contract at `address` on the chain with this id. */
export function deployedHere(chainId: number, address: string): boolean {
  return deployed.get(chainId)?.has(address.toLowerCase()) ?? false;
}

/** The contracts AVAKIT_WRITE_ALLOWLIST lets `write_contract` call: any, or these. */
export type WriteAllowlist = { any: true } | { any: false; addresses: ReadonlySet<string> };

/**
 * AVAKIT_WRITE_ALLOWLIST, read: `*` allows any contract, and otherwise each
 * comma-separated entry is an address, all lowercase or with a valid EIP-55
 * checksum, as `write_contract` takes them. Empty entries are skipped, so a
 * trailing comma is fine. An entry that is not an address is a ToolError that
 * says which one it is without repeating it.
 */
export function writeAllowlist(env: NodeJS.ProcessEnv = process.env): WriteAllowlist {
  const entries = (env[WRITE_ALLOWLIST_ENV] ?? "").split(",").map((entry) => entry.trim());
  if (entries.includes("*")) return { any: true };
  const addresses = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (entry === "") continue;
    if (!ADDRESS_RE.test(entry) || !isAddress(entry)) {
      throw new ToolError(
        `${WRITE_ALLOWLIST_ENV} in the server environment is not a comma-separated list of ` +
          `contract addresses (entry ${index + 1} is not 0x and 40 hex characters, all lowercase or ` +
          "with a valid EIP-55 checksum), so write_contract calls nothing until the person running " +
          `the server fixes it. ${NOTHING_SENT}`,
      );
    }
    addresses.add(entry.toLowerCase());
  }
  return { any: false, addresses };
}

/** A whole number of AVAX, or one with up to 18 decimals: what a wei amount can say exactly. */
const AVAX_AMOUNT = /^\d{1,30}(\.\d{1,18})?$/;

/** The most wei one call may send: AVAKIT_MAX_VALUE, or the default of 0.1 AVAX while it is not set. */
export function maxValue(env: NodeJS.ProcessEnv = process.env): bigint {
  const configured = env[MAX_VALUE_ENV]?.trim() ?? "";
  if (configured === "") return parseEther(DEFAULT_MAX_VALUE);
  if (!AVAX_AMOUNT.test(configured)) {
    // Not repeated: whatever was put there by mistake stays where it is.
    throw new ToolError(
      `${MAX_VALUE_ENV} in the server environment is not an amount of AVAX such as 0.5, so ` +
        "deploy_contract and write_contract sign nothing until the person running the server fixes " +
        `it, or removes it for the default of ${DEFAULT_MAX_VALUE} AVAX. ${NOTHING_SENT}`,
    );
  }
  return parseEther(configured);
}

/**
 * Refuse a call to a contract that this process did not deploy on `chain` and
 * that AVAKIT_WRITE_ALLOWLIST does not list. Mainnet is held to it like Fuji,
 * on top of its own gates (guards.ts).
 */
export function assertCallAllowed(
  chain: AvaChain,
  address: Address,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const allowlist = writeAllowlist(env);
  if (allowlist.any) return;
  if (allowlist.addresses.has(address.toLowerCase()) || deployedHere(chain.id, address)) return;
  throw new ToolError(
    `Refusing to call ${getAddress(address)} on ${chain.name}: write_contract calls only the ` +
      `contracts this server deployed in this session and the ones ${WRITE_ALLOWLIST_ENV} lists in ` +
      `the server environment, which only the person running the server can change. ${NOTHING_SENT}`,
  );
}

/** Refuse a transaction that sends more of the chain's native currency than one call may. */
export function assertValueAllowed(
  chain: AvaChain,
  value: bigint,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const limit = maxValue(env);
  if (value <= limit) return;
  const { symbol } = chain.nativeCurrency;
  const source = env[MAX_VALUE_ENV]?.trim()
    ? `which ${MAX_VALUE_ENV} sets in the server environment`
    : `the default while ${MAX_VALUE_ENV} is not set in the server environment`;
  throw new ToolError(
    `Refusing to send ${formatEther(value)} ${symbol} with this call: one deploy_contract or ` +
      `write_contract call sends at most ${formatEther(limit)} ${symbol}, ${source}, and only the ` +
      `person running the server can change it. ${NOTHING_SENT}`,
  );
}
