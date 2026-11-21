import { fuji } from "@avakit/core/chains";
import type { Locator } from "@playwright/test";
import { type Address, getAddress, type Hex, isAddress, isHash, type PublicClient } from "viem";
import { abi } from "../../lib/nft-artifact";
import { expect } from "./fixtures";

/**
 * The address or transaction hash an explorer link points at, after checking
 * that it is a Fuji explorer link of that kind.
 */
export async function fromExplorerLink(link: Locator, kind: "address"): Promise<Address>;
export async function fromExplorerLink(link: Locator, kind: "tx"): Promise<Hex>;
export async function fromExplorerLink(link: Locator, kind: "address" | "tx"): Promise<string> {
  const prefix = `${fuji.explorerUrl}/${kind}/`;
  const href = (await link.getAttribute("href")) ?? "";
  expect(href.startsWith(prefix), `"${href}" is a link under ${prefix}`).toBe(true);
  const value = href.slice(prefix.length);
  const valid = kind === "address" ? isAddress(value) : isHash(value);
  expect(valid, `"${value}" from the explorer link is a valid ${kind}`).toBe(true);
  return value;
}

/**
 * What the page showed is what the chain says: there is bytecode at
 * `contract`, `mint` is a successful call to it from `wallet`, token 1 exists
 * and belongs to `wallet`, and the wallet sent exactly two transactions (the
 * deploy and the mint).
 *
 * The contract is the AvaKitNFT that both /new and the nft-mint template
 * deploy (lib/nft-artifact.ts is generated from the template's source).
 *
 * The checks are retried for up to `timeout`: a public RPC is served by
 * several nodes, and the one that answers can be a block behind the one the
 * page heard from. Against anvil they pass the first time.
 */
export async function expectMinted(
  chain: PublicClient,
  { contract, mint, wallet }: { contract: Address; mint: Hex; wallet: Address },
  { timeout = 5_000 }: { timeout?: number } = {},
) {
  const nft = { address: contract, abi } as const;
  const owner = getAddress(wallet);

  await expect(async () => {
    const code = await chain.getCode({ address: contract });
    expect(code?.length ?? 0, `bytecode at ${contract}`).toBeGreaterThan(2);

    const receipt = await chain.getTransactionReceipt({ hash: mint });
    expect(receipt.status, "status of the mint transaction").toBe("success");
    expect(getAddress(receipt.from), "sender of the mint").toBe(owner);
    expect(receipt.to && getAddress(receipt.to), "target of the mint").toBe(getAddress(contract));

    expect(await chain.readContract({ ...nft, functionName: "totalSupply" })).toBe(1n);
    expect(await chain.readContract({ ...nft, functionName: "ownerOf", args: [1n] })).toBe(owner);
    expect(await chain.readContract({ ...nft, functionName: "balanceOf", args: [owner] })).toBe(1n);
    expect(await chain.getTransactionCount({ address: owner }), "transactions sent").toBe(2);
  }).toPass({ timeout });
}
