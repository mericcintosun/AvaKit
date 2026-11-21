import { AVAKIT_FAUCET_URL } from "@avakit/core";
import { type AvaChain, fuji } from "@avakit/core/chains";
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
  /**
   * Fuji as the app under test defines it: its RPC endpoint is what anvil
   * answers, and its explorer is where the app's links point. By default the
   * definition this site is built with; a test of another app sets that app's
   * own with `test.use({ appChain })`.
   */
  appChain: AvaChain;
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
  appChain: [fuji, { option: true }],

  anvil: async ({ appChain }, use) => {
    const anvil = await startAnvil({ chainId: appChain.id });
    await use(anvil);
    await anvil.stop();
  },

  chain: async ({ anvil }, use) => {
    await use(createPublicClient({ transport: http(anvil.url) }));
  },

  network: async ({ context, anvil, appChain, baseURL }, use, testInfo) => {
    if (!baseURL) throw new Error("The project has no baseURL (see playwright.config.ts).");
    const { network, stop } = await routeLocalNetwork(context, {
      appOrigin: new URL(baseURL).origin,
      anvilUrl: anvil.url,
      rpcUrls: [appChain.rpcUrl],
      faucetUrl: FAUCET_URL,
      chainId: appChain.id,
      drip: { amount: DRIP_AVAX, wei: parseEther(DRIP_AVAX) },
    });
    await use(network);
    // Torn down before anvil (which this fixture depends on) is stopped.
    stop();
    // A test that stopped early never reached its own checks: say what happened.
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("network", {
        contentType: "text/plain",
        body: report({
          "blocked requests": network.blocked,
          "faucet requests": network.faucetCalls.map((call) => JSON.stringify(call)),
          "JSON-RPC calls answered by anvil": network.rpcMethods,
        }),
      });
    }
  },

  issues: async ({ context }, use, testInfo) => {
    const issues = await watchIssues(context);
    await use(issues);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("browser issues", {
        contentType: "text/plain",
        body: report({
          "CSP violations": issues.cspViolations,
          "uncaught errors": issues.pageErrors,
          "console errors": issues.consoleErrors,
        }),
      });
    }
  },
});

/** Sections of lines under their headings: a repeated line once with its count, "none" for no line. */
function report(sections: Record<string, string[]>): string {
  return Object.entries(sections)
    .map(([heading, lines]) => {
      const counts = new Map<string, number>();
      for (const line of lines.filter(Boolean)) counts.set(line, (counts.get(line) ?? 0) + 1);
      const body = [...counts].map(([line, n]) => `  ${line}${n > 1 ? ` (×${n})` : ""}`);
      return `${heading}:\n${body.length ? body.join("\n") : "  none"}`;
    })
    .join("\n");
}

export { expect } from "@playwright/test";
