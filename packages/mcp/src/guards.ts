import type { AvaChain } from "@avakit/core";

/**
 * Upper bounds for MCP tool inputs. The schemas used to accept `z.array(z.any())`
 * and an unconstrained bytecode string, so a confused or malicious caller could
 * hand over a huge or malformed payload. Generous, but no longer unbounded, and
 * bytecode must actually be hex. (security audit A16)
 */
export const MAX_ABI_ITEMS = 5000;
export const MAX_ARGS = 100;
/** ~1 MB of hex — comfortably above any real EVM creation bytecode. */
export const MAX_BYTECODE_LEN = 2_000_000;
/** Creation bytecode: an optional `0x` prefix followed by hex digits. */
export const BYTECODE_RE = /^(0x)?[0-9a-fA-F]+$/;

/**
 * Mainnet deploys require TWO independent approvals: the tool caller's
 * `confirm: true` AND an out-of-band `AVAKIT_ALLOW_MAINNET=1` server env var.
 *
 * An AI agent can be talked into setting `confirm` by a prompt-injected
 * instruction, but it cannot set an environment variable on the machine
 * running the MCP server — so a malicious prompt alone can never spend real
 * funds. Testnet chains are unaffected. (security audit A2)
 */
export function assertMainnetAllowed(chain: AvaChain, confirm: boolean | undefined): void {
  if (chain.testnet) return;
  if (!confirm) {
    throw new Error(`Refusing to deploy to ${chain.name} (mainnet) without confirm:true.`);
  }
  if (process.env.AVAKIT_ALLOW_MAINNET !== "1") {
    throw new Error(
      `Refusing to deploy to ${chain.name} (mainnet): set AVAKIT_ALLOW_MAINNET=1 in the ` +
        `server environment to allow mainnet deploys. This out-of-band gate cannot be set by a tool caller.`,
    );
  }
}
