import type { AvaChain } from "@avakit/core";

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
