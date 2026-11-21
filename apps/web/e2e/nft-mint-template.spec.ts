import { readFileSync } from "node:fs";
import path from "node:path";
import { fuji } from "@avakit/core/chains";
import type { Page } from "@playwright/test";
import { getAddress } from "viem";
import { expect, test } from "./support/fixtures";
import { expectMinted, fromExplorerLink } from "./support/mint";

/*
 * A freshly scaffolded nft-mint app (`npm create avalanche-app -- --template
 * nft-mint`), production-built from this repository's packages, used the way
 * its README says: connect, deploy the contract, mint. Fuji's RPC and the
 * faucet are answered locally, as for /new (support/network.ts).
 *
 * Social login is checked up to the edge of the network: the option is there,
 * and choosing it starts Web3Auth's SDK with this app's client ID. Nobody
 * signs in. The @external tests go one step further against Web3Auth's real
 * servers and only run when AVAKIT_E2E_EXTERNAL=1 (the scheduled workflow).
 */

const SOCIAL_LOGIN = "Social login (Google, Apple, email)";
const WEB3AUTH_CONFIG = "https://api.web3auth.io/signer-service/api/v2/configuration";

/** The Web3Auth client ID the scaffolded app ships with (app/providers.tsx). */
function demoClientId(): string {
  const dir = process.env.AVAKIT_E2E_TEMPLATE_DIR ?? "";
  const providers = readFileSync(path.join(dir, "app", "providers.tsx"), "utf8");
  const id = /DEMO_WEB3AUTH_CLIENT_ID\s*=\s*"([^"]+)"/.exec(providers)?.[1];
  if (!id) throw new Error("No DEMO_WEB3AUTH_CLIENT_ID in the app's app/providers.tsx.");
  return id;
}

async function openConnectDialog(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Connect a wallet to begin.")).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  const dialog = page.getByRole("dialog", { name: "Get started" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a new user starts with the temporary wallet, deploys the contract and mints", async ({
  page,
  network,
  chain,
  issues,
}) => {
  const dialog = await openConnectDialog(page);
  await dialog.getByRole("button", { name: "Start instantly" }).click();
  await expect(dialog).toBeHidden();

  // The provider asks the faucet by itself for the new, empty wallet.
  await expect(page.getByText("Need more test AVAX?")).toBeVisible({ timeout: 20_000 });
  expect(network.faucetCalls).toEqual([
    { address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), chainId: fuji.id, status: 200 },
  ]);
  const wallet = getAddress(network.faucetCalls[0]?.address ?? "");

  // Step 1: deploy.
  await page.getByRole("button", { name: "Deploy NFT contract" }).click();
  const contractLink = page.getByRole("link", { name: "View contract on explorer" });
  await expect(contractLink).toBeVisible({ timeout: 30_000 });
  const contract = await fromExplorerLink(contractLink, "address");

  // Step 2: mint.
  await page.getByRole("button", { name: "Mint NFT" }).click();
  const minted = page.getByRole("link", { name: /^✓ Minted: 0x[0-9a-f]{64}$/ });
  await expect(minted).toBeVisible({ timeout: 30_000 });
  const mint = await fromExplorerLink(minted, "tx");
  await expect(page.getByText("Total minted", { exact: true }).locator("..")).toHaveText(
    /Total minted\s*1$/,
  );
  await expect(page.getByText("You own", { exact: true }).locator("..")).toHaveText(/You own\s*1$/);

  // What the page showed is what the chain says.
  await expectMinted(chain, { contract, mint, wallet });

  expect(network.faucetCalls, "the faucet is asked once per wallet").toHaveLength(1);
  expect(network.blocked, "requests to hosts these tests do not serve").toEqual([]);
  expect(issues.pageErrors, "uncaught errors").toEqual([]);
  expect(issues.consoleErrors, "console errors").toEqual([]);
});

test("social login is offered, and choosing it starts Web3Auth with this app's client ID", async ({
  page,
  network,
  issues,
}) => {
  const dialog = await openConnectDialog(page);
  const social = dialog.getByRole("button", { name: SOCIAL_LOGIN });
  await expect(social).toBeEnabled();

  // Web3Auth's first call is for this project's configuration. It is answered
  // here as an outage, so no request reaches Web3Auth and nobody signs in.
  await page.route(`${WEB3AUTH_CONFIG}?**`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  const configRequest = page.waitForRequest((request) =>
    request.url().startsWith(`${WEB3AUTH_CONFIG}?`),
  );
  await social.click();

  // The SDK was loaded from the app's own bundle and asked for this app's project.
  const asked = new URL((await configRequest).url());
  expect(asked.searchParams.get("project_id")).toBe(demoClientId());
  expect(asked.searchParams.get("network")).toBe("sapphire_devnet");

  // The failure is reported in the dialog, which stays usable.
  await expect(dialog.getByText(/project config/i)).toBeVisible();
  await expect(social).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Start instantly" })).toBeEnabled();
  expect(issues.pageErrors, "uncaught errors").toEqual([]);
  // Only Web3Auth's own hosts were reached for (the SDK also loads a font and a wallet list).
  expect(
    network.blocked.filter(
      (request) => !/^\w+ https:\/\/[^/]*(web3auth\.io|googleapis\.com)\//.test(request),
    ),
    "requests to other hosts",
  ).toEqual([]);
});

test.describe("against Web3Auth's servers @external", () => {
  async function openWeb3Auth(page: Page) {
    const dialog = await openConnectDialog(page);
    await dialog.getByRole("button", { name: SOCIAL_LOGIN }).click();
    const signIn = page.locator("#w3a-parent-container");
    await expect(signIn.getByText("Sign in", { exact: true })).toBeVisible({ timeout: 30_000 });
    return signIn;
  }

  test("social login opens Web3Auth's sign-in", async ({ page, issues }) => {
    const signIn = await openWeb3Auth(page);
    await expect(signIn.getByRole("button", { name: /Continue with Email\/Phone/ })).toBeVisible();
    expect(issues.pageErrors, "uncaught errors").toEqual([]);
  });

  test("Web3Auth's sign-in takes a click as soon as it opens", async ({ page }) => {
    test.fail(
      true,
      "Known bug: <ConnectAvalanche> (@avakit/react) keeps its modal dialog open behind " +
        "Web3Auth's sign-in, and the dialog turns off pointer events everywhere else, so the " +
        "first click on the sign-in lands on the dialog. Remove this line once it is fixed.",
    );
    const signIn = await openWeb3Auth(page);
    await signIn
      .getByRole("button", { name: /Continue with Email\/Phone/ })
      .click({ trial: true, timeout: 5_000 });
  });
});
