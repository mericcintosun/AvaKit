/**
 * Who signs.
 *
 * Two signers exist, and which one a call gets is decided here and nowhere else:
 *
 *   • "env": the key the person running the server put in AVAKIT_DEPLOYER_KEY.
 *     Their key, their funds, their choice of chain (Fuji, or mainnet behind the
 *     two gates in guards.ts).
 *
 *   • "session": a test wallet this process makes for itself the first time it
 *     is needed, so that someone on a clean machine can deploy to Fuji without
 *     creating, funding and configuring a key first. It is deliberately the
 *     weakest wallet that can still do that job: Fuji only, memory only, zero
 *     value only. Its key is never written to disk, logged, returned or put in
 *     an error message — this file keeps no copy of it to do any of that with.
 *
 * Neither signer hands out its account. What callers get is `signTransaction`,
 * which checks the transaction against those rules at the moment of signing, so
 * a path that forgets a rule further up still cannot get a signature past it.
 * Both also hold every transaction to the server's write limits (limits.ts):
 * the contracts a call may go to, and the AVAX one transaction may send.
 */

import { type AvaChain, isMainnet } from "@avakit/core";
import type { Address, Hex } from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { ToolError } from "./errors.js";
import { mainnetOpenedByOperator } from "./guards.js";
import { assertCallAllowed, assertValueAllowed } from "./limits.js";
import { log } from "./log.js";

/** Avalanche Fuji, the one chain the session test wallet signs for. */
export const FUJI_CHAIN_ID = 43113;
/**
 * Every chain this package puts a signature on: Fuji, and the C-Chain for the
 * user's own key behind both mainnet gates. A signer is not handed out for any
 * other chain, whatever definition a caller passes in.
 */
const SIGNABLE_CHAIN_IDS: ReadonlySet<number> = new Set([FUJI_CHAIN_ID, 43114]);
export const DEPLOYER_KEY_ENV = "AVAKIT_DEPLOYER_KEY";
/** Set to 0 to turn the session test wallet off. */
export const TEST_WALLET_ENV = "AVAKIT_TEST_WALLET";

/** Goes into every result the session wallet signed for. */
export const SESSION_NOTE =
  "Signed with a temporary Fuji test wallet that lives only until the server stops.";

export type SignerSource = "session" | "env";

/** One fully specified EIP-1559 transaction: everything a signature commits to. */
export interface UnsignedTransaction {
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Absent for a contract creation. */
  to?: Address;
  data: Hex;
  value: bigint;
}

export interface Signer {
  readonly address: Address;
  readonly source: SignerSource;
  /** Sign `transaction`, or refuse it. Returns the serialized signed transaction. */
  signTransaction(transaction: UnsignedTransaction): Promise<Hex>;
}

/**
 * The session test wallet. It exists in this variable and nowhere else, and is
 * gone when the process is.
 */
let session: PrivateKeyAccount | undefined;

function sessionAccount(): PrivateKeyAccount {
  if (!session) {
    // Straight from the generator into the account: the key is never held in
    // a variable of ours, so nothing here could log or return it by mistake.
    session = privateKeyToAccount(generatePrivateKey());
    log(
      `created a session test wallet, ${session.address}: Avalanche Fuji only, kept in memory until this server stops.`,
    );
  }
  return session;
}

/**
 * The write limits, asked again at the moment of signing. The tools check them
 * before anything is asked of the chain or the faucet; this is the check that
 * holds when a path forgot that. A creation has no `to`, and goes to no contract.
 */
function assertWithinLimits(chain: AvaChain, transaction: UnsignedTransaction): void {
  if (transaction.to !== undefined) assertCallAllowed(chain, transaction.to);
  assertValueAllowed(chain, transaction.value);
}

function sessionSigner(chain: AvaChain): Signer {
  const account = sessionAccount();
  return {
    address: account.address,
    source: "session",
    async signTransaction(transaction) {
      if (transaction.chainId !== FUJI_CHAIN_ID) {
        throw new ToolError(
          `The session test wallet signs for Avalanche Fuji (chain ${FUJI_CHAIN_ID}) only, and this ` +
            `transaction is for chain ${transaction.chainId}. Nothing was signed.`,
        );
      }
      if (transaction.value !== 0n) {
        // It is funded by a public faucet. A wallet that could forward that
        // money would turn "ask for a drip" into "collect drips".
        throw new ToolError(
          "The session test wallet never sends AVAX with a transaction: it pays for gas on Fuji and " +
            `nothing else. To send value, set ${DEPLOYER_KEY_ENV} to your own funded Fuji key.`,
        );
      }
      assertWithinLimits(chain, transaction);
      return account.signTransaction({ ...transaction, type: "eip1559" });
    },
  };
}

/** The account for AVAKIT_DEPLOYER_KEY, or an error that does not repeat the value. */
function accountFromEnv(configured: string): PrivateKeyAccount {
  // Wallets export keys without the 0x prefix; accept both spellings.
  const hex = /^0x/i.test(configured) ? configured.slice(2) : configured;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    try {
      return privateKeyToAccount(`0x${hex}`);
    } catch {
      // Sixty-four hex characters that are not a key on the curve. Falls
      // through: the library's message for this one prints the number.
    }
  }
  throw new ToolError(
    `${DEPLOYER_KEY_ENV} is not a valid private key: it must be 64 hex characters, with or without ` +
      "a 0x prefix. Its value is not shown here; check it where the server is configured.",
  );
}

function envSigner(configured: string, chain: AvaChain): Signer {
  const account = accountFromEnv(configured);
  return {
    address: account.address,
    source: "env",
    async signTransaction(transaction) {
      if (transaction.chainId !== chain.id) {
        throw new ToolError(
          `This signer was set up for ${chain.name} (chain ${chain.id}) and will not sign a ` +
            `transaction for chain ${transaction.chainId}.`,
        );
      }
      // Asked again at the last moment. The tool handlers check both gates
      // before they get this far; this is the one a tool call cannot move.
      if (isMainnet(chain) && !mainnetOpenedByOperator()) {
        throw new ToolError(
          `Refusing to sign for ${chain.name} (mainnet): AVAKIT_ALLOW_MAINNET=1 is not set in the server environment.`,
        );
      }
      assertWithinLimits(chain, transaction);
      return account.signTransaction({ ...transaction, type: "eip1559" });
    },
  };
}

/** Whether the session test wallet may be used at all. `AVAKIT_TEST_WALLET=0` turns it off. */
export function testWalletEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[TEST_WALLET_ENV]?.trim().toLowerCase() ?? "";
  // Someone who writes "false" or "off" means the same thing, and a switch
  // that guards a signer should not stay on over a spelling.
  return !["0", "false", "off", "no"].includes(value);
}

type Decision =
  | { source: "env"; configured: string }
  | { source: "session" }
  | { source: "none"; why: string };

function decide(chain: AvaChain, env: NodeJS.ProcessEnv): Decision {
  if (!SIGNABLE_CHAIN_IDS.has(chain.id)) {
    return {
      source: "none",
      why:
        "This server signs for Avalanche Fuji and the Avalanche C-Chain only, " +
        `not for ${chain.name} (chain ${chain.id}).`,
    };
  }
  const configured = env[DEPLOYER_KEY_ENV]?.trim();
  if (configured) return { source: "env", configured };
  // Fuji by id, and also by the testnet flag: both have to agree.
  if (chain.id !== FUJI_CHAIN_ID || isMainnet(chain)) {
    return {
      source: "none",
      why:
        `No deployer key found. On ${chain.name} this server signs only with your own key: set ` +
        `${DEPLOYER_KEY_ENV} in the server environment. The session test wallet works on the Fuji testnet only.`,
    };
  }
  if (!testWalletEnabled(env)) {
    return {
      source: "none",
      why:
        `No deployer key found. Set ${DEPLOYER_KEY_ENV} to a 0x private key (use a throwaway testnet ` +
        `key — never a key holding real funds). The session test wallet is turned off (${TEST_WALLET_ENV}=0).`,
    };
  }
  return { source: "session" };
}

/**
 * The signer for a transaction on `chain`, or a `ToolError` that says what is
 * missing. With AVAKIT_DEPLOYER_KEY set it is always that key. Without it, Fuji
 * gets the session test wallet (unless it is turned off) and every other chain
 * gets a refusal.
 *
 * The mainnet gates are not checked here: callers run `assertMainnetAllowed`
 * first, so that a mainnet call without `confirm` is refused as exactly that.
 */
export function resolveSigner(chain: AvaChain, env: NodeJS.ProcessEnv = process.env): Signer {
  const decision = decide(chain, env);
  if (decision.source === "none") throw new ToolError(decision.why);
  return decision.source === "env" ? envSigner(decision.configured, chain) : sessionSigner(chain);
}

export type WalletInfo =
  | { source: SignerSource; address: Address }
  | { source: "none"; address: null; why: string };

/**
 * Which wallet `resolveSigner` would use on `chain`, without signing anything.
 * On Fuji with no key this creates the session wallet if it does not exist yet,
 * so the address it reports is the one a later deploy will come from.
 */
export function walletFor(chain: AvaChain, env: NodeJS.ProcessEnv = process.env): WalletInfo {
  const decision = decide(chain, env);
  if (decision.source === "none") return { source: "none", address: null, why: decision.why };
  return {
    source: decision.source,
    address:
      decision.source === "env"
        ? accountFromEnv(decision.configured).address
        : sessionAccount().address,
  };
}
