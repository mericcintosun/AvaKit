import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Abi, Address, Hex } from "viem";
import { fuji } from "./chains.js";

/**
 * Stub the viem PublicClient so the RPC helpers in `data.ts` never touch the
 * network. `getPublicClient` returns this same fake client for every call, and
 * we assert on how `data.ts` forwards its arguments.
 */
const fakeClient = {
  getBalance: vi.fn(),
  getTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
};

const getPublicClient = vi.fn((_chain: unknown) => fakeClient);

vi.mock("./clients.js", () => ({
  getPublicClient: (chain: unknown) => getPublicClient(chain),
}));

// Import after the mock is registered so `data.ts` binds to the stub.
const { getBalance, getTransactionReceipt, readContract } = await import("./data.js");

const ADDR = "0xd305607510e0db2c95807173c7a05bea53c1ed36" as Address;

beforeEach(() => {
  getPublicClient.mockClear();
  fakeClient.getBalance.mockReset();
  fakeClient.getTransactionReceipt.mockReset();
  fakeClient.readContract.mockReset();
});

describe("data (RPC helpers)", () => {
  it("getBalance builds the Fuji client and forwards the address", async () => {
    fakeClient.getBalance.mockResolvedValue(123n);

    const result = await getBalance(ADDR, fuji);

    expect(getPublicClient).toHaveBeenCalledWith(fuji);
    expect(fakeClient.getBalance).toHaveBeenCalledWith({ address: ADDR });
    expect(result).toBe(123n);
  });

  it("getTransactionReceipt builds the Fuji client and forwards the hash", async () => {
    const hash = "0xabc" as Hex;
    const receipt = { status: "success", transactionHash: hash };
    fakeClient.getTransactionReceipt.mockResolvedValue(receipt);

    const result = await getTransactionReceipt(hash, fuji);

    expect(getPublicClient).toHaveBeenCalledWith(fuji);
    expect(fakeClient.getTransactionReceipt).toHaveBeenCalledWith({ hash });
    expect(result).toBe(receipt);
  });

  it("readContract builds the Fuji client and forwards address/abi/functionName/args", async () => {
    const abi = [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const satisfies Abi;
    fakeClient.readContract.mockResolvedValue(42n);

    const result = await readContract(fuji, {
      address: ADDR,
      abi,
      functionName: "balanceOf",
      args: [ADDR],
    });

    expect(getPublicClient).toHaveBeenCalledWith(fuji);
    expect(fakeClient.readContract).toHaveBeenCalledWith({
      address: ADDR,
      abi,
      functionName: "balanceOf",
      args: [ADDR],
    });
    expect(result).toBe(42n);
  });
});
