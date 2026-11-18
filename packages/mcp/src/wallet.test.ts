import { cChain, defineChain, fuji } from "@avakit/core";
import { parseTransaction, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FUJI_CHAIN_ID,
  resolveSigner,
  testWalletEnabled,
  type UnsignedTransaction,
  walletFor,
} from "./wallet.js";

// Every key this file's code generates, recorded as it is made: the only way a
// test can know the session wallet's key, since nothing hands it out.
const generated = vi.hoisted(() => [] as string[]);
vi.mock("viem/accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/accounts")>();
  return {
    ...actual,
    generatePrivateKey: () => {
      const key = actual.generatePrivateKey();
      generated.push(key);
      return key;
    },
  };
});

const { generatePrivateKey } = await import("viem/accounts");

const transaction = (overrides: Partial<UnsignedTransaction> = {}): UnsignedTransaction => ({
  chainId: FUJI_CHAIN_ID,
  nonce: 0,
  gas: 100_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  data: "0x6080",
  value: 0n,
  ...overrides,
});

/** Everything a caught error says about itself. */
async function failure(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}\n${(error as Error).stack}`;
  }
  throw new Error("expected a refusal");
}

let stderr: string[];
beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.stubEnv("AVAKIT_ALLOW_MAINNET", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the session test wallet", () => {
  it("is created on first use and is the same wallet for the life of the process", () => {
    const before = generated.length;
    const first = resolveSigner(fuji, {});
    const second = resolveSigner(fuji, {});
    const status = walletFor(fuji, {});
    expect(first.source).toBe("session");
    expect(second.address).toBe(first.address);
    expect(status).toEqual({ source: "session", address: first.address });
    // One key was generated for all of that, at most (an earlier test in this
    // file may already have made the wallet).
    expect(generated.length - before).toBeLessThanOrEqual(1);
    expect(generated.length).toBeGreaterThanOrEqual(1);
    expect(privateKeyToAccount(sessionKey()).address).toBe(first.address);
  });

  /** The session wallet's key: the one generated key whose address is the wallet's. */
  function sessionKey(): `0x${string}` {
    const { address } = resolveSigner(fuji, {});
    const key = generated.find(
      (candidate) => privateKeyToAccount(candidate as `0x${string}`).address === address,
    );
    if (!key) throw new Error("the session wallet's key was not generated through the mock");
    return key as `0x${string}`;
  }

  it("signs a Fuji transaction that a node would accept as coming from it", async () => {
    const signer = resolveSigner(fuji, {});
    const serialized = await signer.signTransaction(
      transaction({ to: "0x00000000000000000000000000000000000000c1", data: "0x1249c58b" }),
    );
    expect(parseTransaction(serialized)).toMatchObject({
      chainId: 43113,
      type: "eip1559",
      to: "0x00000000000000000000000000000000000000c1",
      data: "0x1249c58b",
    });
    expect(parseTransaction(serialized).value ?? 0n).toBe(0n);
    expect(await recoverTransactionAddress({ serializedTransaction: serialized as never })).toBe(
      signer.address,
    );
  });

  it("is refused for every chain other than Fuji", async () => {
    const lookalikes = [
      cChain,
      // Fuji's id on a definition that does not say it is a testnet.
      { ...fuji, testnet: false },
      { ...fuji, testnet: undefined as unknown as boolean },
    ];
    for (const chain of lookalikes) {
      expect(() => resolveSigner(chain, {}), chain.name).toThrow(
        /No deployer key found\. On .* this server signs only with your own key: set AVAKIT_DEPLOYER_KEY/,
      );
      expect(walletFor(chain, {})).toMatchObject({ source: "none", address: null });
    }
    // Another testnet: not a mainnet, and still not Fuji.
    const other = defineChain({ ...fuji, id: 99999, name: "Some L1" });
    expect(() => resolveSigner(other, {})).toThrow(
      "This server signs for Avalanche Fuji and the Avalanche C-Chain only, not for Some L1 (chain 99999).",
    );
    expect(walletFor(other, {})).toMatchObject({ source: "none", address: null });

    // And whatever a caller does with the signer it got for Fuji, it signs for Fuji only.
    const signer = resolveSigner(fuji, {});
    for (const chainId of [43114, 1, 99999, 0]) {
      expect(await failure(() => signer.signTransaction(transaction({ chainId })))).toContain(
        `The session test wallet signs for Avalanche Fuji (chain 43113) only, and this transaction is for chain ${chainId}. Nothing was signed.`,
      );
    }
  });

  it("never sends value", async () => {
    const signer = resolveSigner(fuji, {});
    for (const value of [1n, 10n ** 18n]) {
      expect(await failure(() => signer.signTransaction(transaction({ value })))).toContain(
        "The session test wallet never sends AVAX with a transaction: it pays for gas on Fuji and " +
          "nothing else. To send value, set AVAKIT_DEPLOYER_KEY to your own funded Fuji key.",
      );
    }
  });

  it("is turned off by AVAKIT_TEST_WALLET=0, after which a key is asked for as before", () => {
    for (const value of ["0", " 0 ", "false", "FALSE", "off", "no"]) {
      const env = { AVAKIT_TEST_WALLET: value };
      expect(testWalletEnabled(env), value).toBe(false);
      expect(() => resolveSigner(fuji, env), value).toThrow(
        "No deployer key found. Set AVAKIT_DEPLOYER_KEY to a 0x private key (use a throwaway testnet " +
          "key — never a key holding real funds). The session test wallet is turned off (AVAKIT_TEST_WALLET=0).",
      );
      expect(walletFor(fuji, env)).toMatchObject({ source: "none", address: null });
    }
    for (const value of [undefined, "", "1", "true", "on"]) {
      expect(testWalletEnabled({ AVAKIT_TEST_WALLET: value }), String(value)).toBe(true);
    }
  });

  it("is not created while it is turned off, or for a chain it cannot be used on", async () => {
    vi.resetModules();
    const fresh = await import("./wallet.js");
    const before = generated.length;
    expect(() => fresh.resolveSigner(fuji, { AVAKIT_TEST_WALLET: "0" })).toThrow();
    expect(() => fresh.resolveSigner(cChain, {})).toThrow();
    fresh.walletFor(cChain, {});
    fresh.walletFor(fuji, { AVAKIT_DEPLOYER_KEY: generatePrivateKey() });
    // The one key generated here is the stand-in for the user's own, above.
    expect(generated.length - before).toBe(1);
    expect(stderr.join("")).not.toContain("session test wallet");

    // First real use makes it, and says so on stderr: the address, not the key.
    const signer = fresh.resolveSigner(fuji, {});
    expect(generated.length - before).toBe(2);
    expect(stderr.join("")).toBe(
      `avakit-mcp: created a session test wallet, ${signer.address}: Avalanche Fuji only, kept in memory until this server stops.\n`,
    );
  });

  it("keeps its key to itself: nothing it returns, throws or logs contains it", async () => {
    const signer = resolveSigner(fuji, {});
    const key = sessionKey();
    const everything = [
      JSON.stringify(signer),
      JSON.stringify(Object.entries(signer)),
      Object.getOwnPropertyNames(signer).join(","),
      String(signer.signTransaction),
      JSON.stringify(walletFor(fuji, {})),
      await signer.signTransaction(transaction()),
      await failure(() => signer.signTransaction(transaction({ chainId: 43114 }))),
      await failure(() => signer.signTransaction(transaction({ value: 1n }))),
      await failure(() => resolveSigner(cChain, {})),
      await failure(() => resolveSigner(fuji, { AVAKIT_TEST_WALLET: "0" })),
      stderr.join(""),
    ].join("\n");
    expect(everything.length).toBeGreaterThan(500);
    expect(everything.toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    // The signer is three things, and an account is not one of them.
    expect(Object.keys(signer).sort()).toEqual(["address", "signTransaction", "source"]);
  });
});

describe("a key from AVAKIT_DEPLOYER_KEY", () => {
  it("is used whenever it is set, on Fuji and on mainnet, instead of the session wallet", () => {
    const key = generatePrivateKey();
    const { address } = privateKeyToAccount(key);
    for (const chain of [fuji, cChain]) {
      for (const spelling of [
        key,
        key.slice(2),
        ` ${key}\n`,
        key.toUpperCase().replace("0X", "0x"),
      ]) {
        const env = { AVAKIT_DEPLOYER_KEY: spelling, AVAKIT_TEST_WALLET: "0" };
        expect(resolveSigner(chain, env)).toMatchObject({ source: "env", address });
        expect(walletFor(chain, env)).toEqual({ source: "env", address });
      }
    }
  });

  it("refuses a value that is not a key, without repeating it", async () => {
    const values = [
      "0x1234",
      `0x${"zz".repeat(32)}`,
      `0x${"ab".repeat(33)}`,
      // On no curve: the library's message for these prints the number.
      `0x${"00".repeat(32)}`,
      `0x${"ff".repeat(32)}`,
      "my secret seed phrase words",
    ];
    for (const value of values) {
      for (const run of [
        () => resolveSigner(fuji, { AVAKIT_DEPLOYER_KEY: value }),
        () => walletFor(cChain, { AVAKIT_DEPLOYER_KEY: value }),
      ]) {
        const said = await failure(run);
        expect(said).toContain(
          "AVAKIT_DEPLOYER_KEY is not a valid private key: it must be 64 hex characters, with or " +
            "without a 0x prefix. Its value is not shown here; check it where the server is configured.",
        );
        expect(said).not.toContain(value);
        expect(said).not.toContain(value.replace(/^0x/, ""));
        // The out-of-range key as a decimal number, which is how the curve
        // library's own message would have shown it.
        expect(said).not.toContain(BigInt(`0x${"ff".repeat(32)}`).toString());
        expect(said).not.toContain("expected valid private key");
      }
    }
  });

  it("signs for the chain it was resolved for and no other", async () => {
    const env = { AVAKIT_DEPLOYER_KEY: generatePrivateKey() };
    const signer = resolveSigner(fuji, env);
    const serialized = await signer.signTransaction(transaction({ value: 5n }));
    expect(parseTransaction(serialized)).toMatchObject({ chainId: 43113, value: 5n });
    expect(await recoverTransactionAddress({ serializedTransaction: serialized as never })).toBe(
      signer.address,
    );
    expect(await failure(() => signer.signTransaction(transaction({ chainId: 43114 })))).toContain(
      "This signer was set up for Avalanche Fuji (chain 43113) and will not sign a transaction for chain 43114.",
    );
  });

  it("is not handed out for a chain this server was not built for", () => {
    // Whatever chain definition reaches this code, a key signs for Fuji or the
    // C-Chain and for nothing else: not another L1, not another network.
    const env = { AVAKIT_DEPLOYER_KEY: generatePrivateKey() };
    for (const chain of [
      defineChain({ ...fuji, id: 99999, name: "Some L1" }),
      defineChain({ ...cChain, id: 1, name: "Ethereum" }),
    ]) {
      expect(() => resolveSigner(chain, env), chain.name).toThrow(
        `This server signs for Avalanche Fuji and the Avalanche C-Chain only, not for ${chain.name} (chain ${chain.id}).`,
      );
      expect(walletFor(chain, env)).toMatchObject({ source: "none", address: null });
    }
  });

  it("will not sign for mainnet while the server environment has not allowed it", async () => {
    // The tool handlers check both mainnet gates first. This is the last line:
    // even code that skipped them cannot get a mainnet signature.
    const env = { AVAKIT_DEPLOYER_KEY: generatePrivateKey() };
    const signer = resolveSigner(cChain, env);
    const mainnet = transaction({ chainId: 43114 });
    for (const value of ["", "0", "true", "yes"]) {
      vi.stubEnv("AVAKIT_ALLOW_MAINNET", value);
      expect(await failure(() => signer.signTransaction(mainnet))).toContain(
        "Refusing to sign for Avalanche C-Chain (mainnet): AVAKIT_ALLOW_MAINNET=1 is not set in the server environment.",
      );
    }
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    expect(parseTransaction(await signer.signTransaction(mainnet)).chainId).toBe(43114);
  });
});
