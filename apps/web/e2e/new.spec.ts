import { fuji } from "@avakit/core/chains";
import { getAddress } from "viem";
import { DRIP_AVAX, expect, test } from "./support/fixtures";
import { expectMinted, fromExplorerLink } from "./support/mint";

/*
 * avakit.dev/new end to end, against a local chain: the temporary wallet is
 * created, the faucet funds it, the visitor deploys the NFT contract and mints
 * from it. Fuji's RPC and the faucet are answered locally (support/network.ts),
 * so this runs on every pull request without touching the real Fuji or the
 * shared faucet. new.fuji.spec.ts does the same on the real Fuji.
 */

test("a visitor deploys an NFT contract and mints from it with a temporary wallet", async ({
  page,
  network,
  chain,
  issues,
}) => {
  await page.goto("/new");

  // Nothing happens until the visitor asks for it: no wallet, no faucet request.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A real transaction");
  await page.getByRole("button", { name: "Let's go" }).click();

  // 1. A temporary wallet appears.
  await expect(page.getByText("temporary, in this browser")).toBeVisible();

  // 2. The faucet funds it.
  await expect(
    page.getByText("This demo has no faucet configured yet."),
    "the site was built without NEXT_PUBLIC_AVAKIT_FAUCET_URL (see playwright.config.ts)",
  ).toHaveCount(0);
  await expect(page.getByText(`${DRIP_AVAX} AVAX on Fuji testnet`)).toBeVisible({
    timeout: 20_000,
  });
  expect(network.faucetCalls).toEqual([
    { address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), chainId: fuji.id, status: 200 },
  ]);
  const wallet = getAddress(network.faucetCalls[0]?.address ?? "");

  // 3. Deploy.
  await page.getByRole("button", { name: "Deploy it" }).click();
  const contractLink = page.getByRole("link", { name: /live on Fuji/ });
  await expect(contractLink).toBeVisible({ timeout: 30_000 });
  const contract = await fromExplorerLink(contractLink, "address");

  // 4. Mint, and the art is read back from the chain.
  await page.getByRole("button", { name: "Mint one" }).click();
  const mintLink = page.getByRole("link", { name: "See your mint on Fuji" });
  await expect(mintLink).toBeVisible({ timeout: 30_000 });
  const mint = await fromExplorerLink(mintLink, "tx");
  // Token 1, named by the contract's own tokenURI ("AvaKit #001").
  await expect(page.getByRole("img", { name: /^AvaKit #0*1$/ })).toBeVisible();
  await expect(page.getByText("That was a real transaction")).toBeVisible();

  // What the page showed is what the chain says.
  await expectMinted(chain, { contract, mint, wallet });

  // A clean run: one drip, nothing outside the app reached, nothing wrong in the browser.
  expect(network.faucetCalls, "the faucet is asked once per wallet").toHaveLength(1);
  expect(network.blocked, "requests to hosts these tests do not serve").toEqual([]);
  expect(issues.pageErrors, "uncaught errors").toEqual([]);
  expect(issues.consoleErrors, "console errors").toEqual([]);
  expect(issues.cspViolations, "CSP violations").toEqual([]);
});
