import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

/*
 * Browser end-to-end tests. Three suites, picked with AVAKIT_E2E_SUITE:
 *
 *   site (default)  The website, against a production build of it. /new runs
 *                   its whole flow (temporary wallet, faucet, deploy, mint)
 *                   against a local anvil chain, and the key routes must load
 *                   without a console error or a CSP violation. Nothing leaves
 *                   the machine: Fuji's RPC and the faucet are answered
 *                   locally and any other external request fails the test.
 *   template        A scaffolded nft-mint app (production build), the same
 *                   way: connect the temporary wallet, deploy, mint, and the
 *                   social login (Web3Auth) entry point. Set
 *                   AVAKIT_E2E_TEMPLATE_DIR to the app's directory.
 *   fuji            /new on the real Fuji testnet, through AvaKit's hosted
 *                   faucet: one drip and two transactions per run. Only the
 *                   scheduled workflow runs it (tag @fuji).
 *
 * Run the site suite locally (Foundry's anvil on PATH):
 *
 *   NEXT_PUBLIC_AVAKIT_FAUCET_URL=https://avakit-faucet.avakit.workers.dev/fund \
 *     pnpm --filter @avakit/web build
 *   pnpm --filter @avakit/web test:e2e
 *
 * The build bakes the faucet URL into /new, and the tests answer requests to
 * that same URL, so build and test with the same NEXT_PUBLIC_AVAKIT_FAUCET_URL
 * (the tests default to the one above, which is what avakit.dev uses).
 *
 * The template suite: build @avakit/core, @avakit/react and the scaffolder,
 * scaffold and build the app with scripts/smoke-template.sh, then point the
 * suite at it:
 *
 *   pnpm --filter @avakit/core --filter @avakit/react --filter create-avalanche-app build
 *   bash scripts/smoke-template.sh nft-mint /tmp/avakit-e2e
 *   AVAKIT_E2E_SUITE=template AVAKIT_E2E_TEMPLATE_DIR=/tmp/avakit-e2e/smoke-nft-mint \
 *     pnpm --filter @avakit/web test:e2e
 *
 * .github/workflows/e2e-browser.yml runs all three.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CI = Boolean(process.env.CI);

const SUITES = ["site", "template", "fuji"] as const;
type Suite = (typeof SUITES)[number];

const suite = (process.env.AVAKIT_E2E_SUITE || "site") as Suite;
if (!SUITES.includes(suite)) {
  throw new Error(`AVAKIT_E2E_SUITE must be one of ${SUITES.join(", ")}, not "${suite}".`);
}

const sitePort = Number(process.env.AVAKIT_E2E_SITE_PORT || 3217);
const templatePort = Number(process.env.AVAKIT_E2E_TEMPLATE_PORT || 3218);

// Tests tagged @external talk to third-party servers for real (Web3Auth's).
// They are left out unless AVAKIT_E2E_EXTERNAL=1, as the scheduled run sets.
const excluded = process.env.AVAKIT_E2E_EXTERNAL === "1" ? /@fuji/ : /@fuji|@external/;

/** `next start` for the production build in `dir`, on `port`. */
function nextStart(dir: string, port: number): NonNullable<PlaywrightTestConfig["webServer"]> {
  return {
    command: `node node_modules/next/dist/bin/next start --port ${port} --hostname localhost`,
    cwd: dir,
    url: `http://localhost:${port}`,
    // Never test a server this run did not start: it could be anything.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  };
}

function templateDir(): string {
  const dir = process.env.AVAKIT_E2E_TEMPLATE_DIR;
  if (!dir) {
    throw new Error(
      "AVAKIT_E2E_SUITE=template needs AVAKIT_E2E_TEMPLATE_DIR: the directory of a scaffolded " +
        "and built nft-mint app (see the top of playwright.config.ts).",
    );
  }
  const resolved = path.resolve(dir);
  if (!existsSync(path.join(resolved, ".next", "BUILD_ID"))) {
    throw new Error(`${resolved} has no production build. Run \`npm run build\` in it first.`);
  }
  return resolved;
}

const browser = { ...devices["Desktop Chrome"] };

const suites: Record<Suite, Pick<PlaywrightTestConfig, "projects" | "webServer">> = {
  site: {
    projects: [
      {
        name: "site",
        testMatch: ["new.spec.ts", "routes.spec.ts"],
        grepInvert: excluded,
        use: { ...browser, baseURL: `http://localhost:${sitePort}` },
      },
    ],
    webServer: nextStart(here, sitePort),
  },
  template: {
    projects: [
      {
        name: "template",
        testMatch: ["nft-mint-template.spec.ts"],
        grepInvert: excluded,
        use: { ...browser, baseURL: `http://localhost:${templatePort}` },
      },
    ],
    webServer: suite === "template" ? nextStart(templateDir(), templatePort) : undefined,
  },
  fuji: {
    projects: [
      {
        name: "fuji",
        testMatch: ["new.fuji.spec.ts"],
        grep: /@fuji/,
        // One faucet drip per run: a failed attempt is never repeated.
        retries: 0,
        timeout: 8 * 60_000,
        use: { ...browser, baseURL: `http://localhost:${sitePort}` },
      },
    ],
    webServer: nextStart(here, sitePort),
  },
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  // Every test starts its own anvil and browser context, so tests are independent.
  fullyParallel: true,
  forbidOnly: CI,
  // A flaky test should be fixed, not retried until it passes.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["list"], ["github"], ["html", { outputFolder: "./e2e/.report", open: "never" }]]
    : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  ...suites[suite],
});
