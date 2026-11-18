import {
  BaseError,
  InsufficientFundsError,
  RpcRequestError,
  TransactionExecutionError,
  UserRejectedRequestError,
} from "viem";
import { describe, expect, it } from "vitest";
import { cn, humanizeError, shortenAddress } from "./utils.js";

const REJECTED = "You rejected the request in your wallet.";
const FUND_IT = "Not enough native balance to cover gas. Fund this wallet and try again.";

/** What viem throws from sendTransaction / writeContract, wrapping `cause`. */
function transactionError(cause: BaseError): TransactionExecutionError {
  return new TransactionExecutionError(cause, {
    account: { address: "0x000000000000000000000000000000000000dEaD", type: "json-rpc" },
    to: "0x00000000000000000000000000000000000000A1",
    value: 0n,
  });
}

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false, undefined, "font-bold")).toBe("text-sm font-bold");
  });
});

describe("shortenAddress", () => {
  const addr = "0x000000000000000000000000000000000000dEaD";
  it("truncates to 0x + 4 + … + 4 by default", () => {
    expect(shortenAddress(addr)).toBe("0x0000…dEaD");
  });
  it("respects a custom char count", () => {
    expect(shortenAddress(addr, 6)).toBe("0x000000…00dEaD");
  });
});

describe("humanizeError", () => {
  it("prefers viem's shortMessage over message", () => {
    expect(
      humanizeError({ shortMessage: "User rejected the request.", message: "long dump" }),
    ).toBe("You rejected the request in your wallet.");
  });

  it("recognizes user rejection (including code 4001)", () => {
    expect(humanizeError(new Error("User denied transaction signature (4001)"))).toBe(
      "You rejected the request in your wallet.",
    );
  });

  it("recognizes insufficient funds", () => {
    expect(humanizeError(new Error("insufficient funds for gas"))).toContain("Fund this wallet");
  });

  // viem's short message for an unfunded sender reads "The total cost (gas * gas
  // fee + value) of executing this transaction exceeds the balance of the
  // account." — no "insufficient funds" in it, so the old text match missed the
  // very error an empty burner wallet produces.
  it("recognizes viem's insufficient-funds error from a real send", () => {
    const fromNode = new RpcRequestError({
      body: { method: "eth_estimateGas" },
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      error: {
        code: -32000,
        message: "insufficient funds for gas * price + value: balance 0, tx cost 21000000000000",
      },
    });
    const error = transactionError(new InsufficientFundsError({ cause: fromNode }));

    expect(error.shortMessage).not.toMatch(/insufficient funds/i);
    expect(humanizeError(error)).toBe(FUND_IT);
  });

  it("recognizes insufficient funds from the node's wording kept in details", () => {
    // A wrapper viem did not classify: only `details` still says what happened.
    const error = new BaseError("An unknown RPC error occurred.", {
      details: "insufficient funds for gas * price + value: balance 0",
    });
    expect(humanizeError(error)).toBe(FUND_IT);
  });

  it("recognizes AvaKit's own InsufficientFundsError by name", () => {
    const error = Object.assign(new Error("0x… holds 0 AVAX on Avalanche C-Chain."), {
      name: "InsufficientFundsError",
    });
    expect(humanizeError(error)).toBe(FUND_IT);
  });

  it("recognizes a rejection by its 4001 code anywhere in the cause chain", () => {
    // The raw EIP-1193 error a wallet rejects with: the wording is the wallet's own.
    expect(humanizeError({ code: 4001, message: "Request declined." })).toBe(REJECTED);

    const fromViem = transactionError(
      new UserRejectedRequestError(new Error("MetaMask Tx Signature: declined.")),
    );
    expect(humanizeError(fromViem)).toBe(REJECTED);

    // Wrapped once more by application code, with wording of its own.
    expect(humanizeError(new Error("Mint failed", { cause: fromViem }))).toBe(REJECTED);
    expect(humanizeError({ code: "ACTION_REJECTED", message: "rejected by signer" })).toBe(
      REJECTED,
    );
  });

  // "4001" used to be matched anywhere in the text, so any error that happened
  // to contain those digits was reported as a rejection.
  it("does not mistake the digits 4001 in an error text for a rejection", () => {
    expect(humanizeError(new Error("connect ECONNREFUSED 127.0.0.1:4001"))).toBe(
      "connect ECONNREFUSED 127.0.0.1:4001",
    );
    expect(humanizeError(new Error("execution reverted: order 4001 does not exist"))).toBe(
      "execution reverted: order 4001 does not exist",
    );
    expect(humanizeError({ shortMessage: 'Transaction "0x40019c…" could not be found.' })).not.toBe(
      REJECTED,
    );
  });

  it("recognizes a low token allowance", () => {
    expect(humanizeError(new Error("ERC20: insufficient allowance"))).toContain(
      "approve the token",
    );
  });

  it("recognizes a wrong-network / chain mismatch", () => {
    expect(humanizeError(new Error("chain mismatch: wrong network"))).toContain("wrong network");
  });

  it("recognizes a nonce problem", () => {
    expect(humanizeError(new Error("nonce too low"))).toContain("nonce");
  });

  it("falls back to the first line, truncated to 200 chars", () => {
    const long = `${"x".repeat(300)}\nsecond line`;
    const out = humanizeError(new Error(long));
    expect(out.length).toBe(200);
    expect(out).not.toContain("second line");
  });

  it("handles non-Error/string inputs without throwing", () => {
    expect(typeof humanizeError("plain string error")).toBe("string");
    expect(typeof humanizeError(null)).toBe("string");
  });
});
