import { AVAKIT_FAUCET_URL } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { test as base } from "@playwright/test";
import { createPublicClient, http, type PublicClient, parseEther } from "viem";
import { type Anvil, startAnvil } from "./anvil";
import { type BrowserIssues, watchIssues } from "./issues";
import { type LocalNetwork, routeLocalNetwork } from "./network";

/**
 * The faucet the app under test was built with. The site reads it from
 * NEXT_PUBLIC_AVAKIT_FAUCET_URL at build time; a scaffolded app falls back to
 * AvaKit's shared faucet when the variable is unset. Build and test with the
 * same value (playwright.config.ts says how).
 */
export const FAUCET_URL = process.env.NEXT_PUBLIC_AVAKIT_FAUCET_URL?.trim() || AVAKIT_FAUCET_URL;

/** What one drip of the AvaKit faucet is (FAUCET_DRIP_AVAX in services/faucet/wrangler.toml). */
export const DRIP_AVAX = "0.02";

interface Fixtures {
  /** A fresh local chain with Fuji's chain id, for this test only. */
  anvil: Anvil;
  /** A viem client reading that chain, to check what the page did on-chain. */
  chain: PublicClient;
  /** Fuji RPC and the faucet answered locally; every other external request blocked. */
  network: LocalNetwork;
  /** Console errors, uncaught errors and CSP violations from every page of the test. */
  issues: BrowserIssues;
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
  anvil: async ({}, use) => {
    const anvil = await startAnvil({ chainId: fuji.id });
    await use(anvil);
    await anvil.stop();
  },

  chain: async ({ anvil }, use) => {
    await use(createPublicClient({ transport: http(anvil.url) }));
  },

  network: async ({ context, anvil, baseURL }, use) => {
    if (!baseURL) throw new Error("The project has no baseURL (see playwright.config.ts).");
    await use(
      await routeLocalNetwork(context, {
        appOrigin: new URL(baseURL).origin,
        anvilUrl: anvil.url,
        rpcUrls: [fuji.rpcUrl],
        faucetUrl: FAUCET_URL,
        chainId: fuji.id,
        drip: { amount: DRIP_AVAX, wei: parseEther(DRIP_AVAX) },
      }),
    );
  },

  issues: async ({ context }, use) => {
    await use(await watchIssues(context));
  },
});

export { expect } from "@playwright/test";
