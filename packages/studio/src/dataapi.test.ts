import { beforeEach, describe, expect, it, vi } from "vitest";

// The Data API wrappers are mocked: these tests never touch the network.
const core = vi.hoisted(() => ({
  getNativeBalance: vi.fn(),
  listErc20Balances: vi.fn(),
  listNfts: vi.fn(),
  listTransactions: vi.fn(),
}));
vi.mock("@avakit/core", () => core);

import { getAddressData } from "./dataapi.js";

const ADDRESS = `0x${"ab".repeat(20)}`;

function healthy(): void {
  core.getNativeBalance.mockResolvedValue({
    nativeTokenBalance: { symbol: "AVAX", balance: "1500000000000000000", decimals: 18 },
  });
  core.listErc20Balances.mockResolvedValue({
    erc20TokenBalances: [
      { address: "0x01", symbol: "USDC", name: "USD Coin", balance: "2500000", decimals: 6 },
      { address: "0x02", symbol: "DUST", name: "Dust", balance: "0", decimals: 18 },
    ],
  });
  core.listNfts.mockResolvedValue({
    erc721TokenBalances: [{ address: "0x03", name: "Badge", symbol: "BDG", tokenId: "7" }],
  });
  core.listTransactions.mockResolvedValue({
    transactions: [
      {
        nativeTransaction: {
          txHash: "0xaaa",
          from: { address: "0x10" },
          to: { address: "0x11" },
          blockTimestamp: 1700000000,
          method: { methodName: "mint" },
          txStatus: "1",
        },
      },
      {
        // A contract creation has no `to` and no decoded method.
        nativeTransaction: {
          txHash: "0xbbb",
          from: { address: "0x10" },
          blockTimestamp: 1700000001,
          txStatus: "0",
        },
      },
    ],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getAddressData", () => {
  it("summarises the four sections and reports no errors", async () => {
    healthy();
    const data = await getAddressData(ADDRESS, 43113);
    expect(data).toEqual({
      native: { symbol: "AVAX", balance: "1500000000000000000", decimals: 18 },
      // Zero balances are dropped.
      tokens: [
        { address: "0x01", symbol: "USDC", name: "USD Coin", balance: "2500000", decimals: 6 },
      ],
      nfts: [{ address: "0x03", name: "Badge", symbol: "BDG", tokenId: "7" }],
      transactions: [
        {
          txHash: "0xaaa",
          from: "0x10",
          to: "0x11",
          timestamp: 1700000000,
          method: "mint",
          status: "1",
        },
        { txHash: "0xbbb", from: "0x10", to: "", timestamp: 1700000001, method: null, status: "0" },
      ],
      errors: {},
    });
    expect(core.getNativeBalance).toHaveBeenCalledWith(ADDRESS, 43113);
  });

  it("marks a section whose call failed instead of passing it off as empty", async () => {
    healthy();
    core.getNativeBalance.mockRejectedValue(
      new Error("Data API request failed (429): Too Many Requests"),
    );
    core.listNfts.mockRejectedValue(new Error("fetch failed"));
    const data = await getAddressData(ADDRESS, 43113);
    expect(data.errors).toEqual({
      native: "Data API request failed (429): Too Many Requests",
      nfts: "fetch failed",
    });
    // The failed sections carry placeholders; the others are intact.
    expect(data.native).toBeNull();
    expect(data.nfts).toEqual([]);
    expect(data.tokens).toHaveLength(1);
    expect(data.transactions).toHaveLength(2);
  });

  it("reports every section when the Data API is unreachable", async () => {
    for (const fn of Object.values(core)) fn.mockRejectedValue(new TypeError("fetch failed"));
    const data = await getAddressData(ADDRESS, 43114);
    expect(Object.keys(data.errors).sort()).toEqual(["native", "nfts", "tokens", "transactions"]);
    expect(data).toMatchObject({ native: null, tokens: [], nfts: [], transactions: [] });
  });

  it("treats a malformed response as a failed section, not a crash", async () => {
    healthy();
    core.getNativeBalance.mockResolvedValue({});
    core.listTransactions.mockResolvedValue({ transactions: [{}] });
    const data = await getAddressData(ADDRESS, 43113);
    expect(Object.keys(data.errors).sort()).toEqual(["native", "transactions"]);
    expect(data.tokens).toHaveLength(1);
  });

  it("keeps long error texts short", async () => {
    healthy();
    core.listErc20Balances.mockRejectedValue(new Error("x".repeat(1000)));
    expect((await getAddressData(ADDRESS, 43113)).errors.tokens).toHaveLength(200);
  });
});
