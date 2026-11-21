import { fuji } from "@avakit/core/chains";
import { createPublicClient, getAddress, http } from "viem";
import { expect, FAUCET_URL, test } from "./support/fixtures";
import { expectMinted, fromExplorerLink } from "./support/mint";

/*
 * avakit.dev/new on the real Fuji testnet, as a visitor goes through it: the
 * temporary wallet is funded by AvaKit's hosted faucet, then deploys the NFT
 * contract and mints from it. Nothing is answered locally.
 *
 * It costs one faucet drip and two Fuji transactions, so it only runs in the
 * scheduled workflow (AVAKIT_E2E_SUITE=fuji) and is never retried. When the
 * faucet refuses (it is shared and rate-limited), the test fails at once with
 * the faucet's own words; nothing asks it a second time.
 */

test("a visitor deploys an NFT contract and mints from it on Fuji @fuji", async ({
  page,
  issues,
}) => {
  const faucetRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url() === FAUCET_URL) {
      faucetRequests.push(request.postData() ?? "");
    }
  });

  await page.goto("/new");
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByText("temporary, in this browser")).toBeVisible();

  // Funded, or refused: whichever the faucet answers first.
  const funded = page.getByText(/ AVAX on Fuji testnet$/);
  const refused = page.getByText(
    /^(Our faucet couldn't fund this wallet|Our faucet didn't answer|This demo has no faucet)/,
  );
  await expect(funded.or(refused).first()).toBeVisible({ timeout: 90_000 });
  if (await refused.count()) {
    throw new Error(`The faucet did not fund the wallet: ${await refused.first().innerText()}`);
  }
  expect(faucetRequests, "requests to the faucet").toHaveLength(1);
  const wallet = getAddress(JSON.parse(faucetRequests[0] ?? "{}").address);

  await page.getByRole("button", { name: "Deploy it" }).click();
  const contractLink = page.getByRole("link", { name: /live on Fuji/ });
  await expect(contractLink).toBeVisible({ timeout: 120_000 });
  const contract = await fromExplorerLink(contractLink, "address");

  await page.getByRole("button", { name: "Mint one" }).click();
  const mintLink = page.getByRole("link", { name: "See your mint on Fuji" });
  await expect(mintLink).toBeVisible({ timeout: 120_000 });
  const mint = await fromExplorerLink(mintLink, "tx");
  await expect(page.getByRole("img", { name: /^AvaKit #0*1$/ })).toBeVisible({ timeout: 30_000 });
  console.log(`Minted on Fuji: ${fuji.explorerUrl}/tx/${mint} (contract ${contract})`);

  const chain = createPublicClient({ transport: http(fuji.rpcUrl) });
  await expectMinted(chain, { contract, mint, wallet }, { timeout: 60_000 });

  expect(faucetRequests, "one drip per run").toHaveLength(1);
  expect(issues.pageErrors, "uncaught errors").toEqual([]);
  expect(issues.consoleErrors, "console errors").toEqual([]);
  expect(issues.cspViolations, "CSP violations").toEqual([]);
});
