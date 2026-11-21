/**
 * The write limits (limits.ts): which contracts write_contract calls, and how
 * much AVAX one signing call sends. Read from the server's environment, checked
 * through the tools on the fake network, and checked again by the signer, which
 * holds a transaction to the same limits when a caller skipped the tools' check.
 *
 * Every test starts a fresh server: the contracts a server deployed belong to
 * its process, and a test should not inherit another one's.
 */

import { readFileSync } from "node:fs";
import { fuji } from "@avakit/core";
import { getAddress, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_VALUE, maxValue, writeAllowlist } from "./limits.js";
import type { Connection } from "./testing/connect.js";
import type { FakeNetwork } from "./testing/network.js";
import type { UnsignedTransaction } from "./wallet.js";

const CONTRACT = "0x00000000000000000000000000000000000000c1";
const OTHER = "0x00000000000000000000000000000000000000c2";
const CHECKSUMMED = "0x52908400098527886E0F7030069857D2E4169EE7";
const MINT = ["function mint() returns (uint256)"];
const BUY = ["function buy() payable"];
const DEPLOY = { abi: [], bytecode: "0x6080" };
const AVAX = 10n ** 18n;

/** What write_contract answers for a contract it may not call. */
const refusedCall = (address: string, chain = "Avalanche Fuji") =>
  `Refusing to call ${getAddress(address)} on ${chain}: write_contract calls only the contracts ` +
  "this server deployed in this session and the ones AVAKIT_WRITE_ALLOWLIST lists in the server " +
  "environment, which only the person running the server can change. Nothing was signed or sent.";

/** What a signing tool answers for more AVAX than one call may send. */
const refusedValue = (sent: string, limit: string, setBy: "default" | "env") =>
  `Refusing to send ${sent} AVAX with this call: one deploy_contract or write_contract call sends ` +
  `at most ${limit} AVAX, ${
    setBy === "default"
      ? "the default while AVAKIT_MAX_VALUE is not set in the server environment"
      : "which AVAKIT_MAX_VALUE sets in the server environment"
  }, and only the person running the server can change it. Nothing was signed or sent.`;

const unreadableList = (entry: number) =>
  "AVAKIT_WRITE_ALLOWLIST in the server environment is not a comma-separated list of contract " +
  `addresses (entry ${entry} is not 0x and 40 hex characters, all lowercase or with a valid EIP-55 ` +
  "checksum), so write_contract calls nothing until the person running the server fixes it. " +
  "Nothing was signed or sent.";

const UNREADABLE_VALUE =
  "AVAKIT_MAX_VALUE in the server environment is not an amount of AVAX such as 0.5, so " +
  "deploy_contract and write_contract sign nothing until the person running the server fixes it, " +
  "or removes it for the default of 0.1 AVAX. Nothing was signed or sent.";

/** The message a call throws, or "" when it does not. */
function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("AVAKIT_WRITE_ALLOWLIST, as the server reads it", () => {
  it("lists nothing while it is not set, which leaves this session's deployments", () => {
    for (const value of [undefined, "", "   ", ",", " , ,"]) {
      expect(writeAllowlist({ AVAKIT_WRITE_ALLOWLIST: value }), String(value)).toEqual({
        any: false,
        addresses: new Set(),
      });
    }
  });

  it("takes addresses separated by commas, checksummed or not, and keeps them in lowercase", () => {
    const value = ` ${CHECKSUMMED} ,${CONTRACT},${CHECKSUMMED.toLowerCase()},`;
    expect(writeAllowlist({ AVAKIT_WRITE_ALLOWLIST: value })).toEqual({
      any: false,
      addresses: new Set([CHECKSUMMED.toLowerCase(), CONTRACT]),
    });
  });

  it("allows any contract with *, on its own or among addresses", () => {
    for (const value of ["*", " * ", `${CONTRACT},*`, `*, ${OTHER}`]) {
      expect(writeAllowlist({ AVAKIT_WRITE_ALLOWLIST: value }), value).toEqual({ any: true });
    }
  });

  it("refuses a list with an entry that is not an address, by its place and without its text", () => {
    const lists: [string, number][] = [
      ["0x1234", 1],
      // Mixed case that is not a valid checksum: one character off somewhere.
      [`${CONTRACT},0x52908400098527886E0F7030069857D2E4169ee7`, 2],
      // Places are counted by commas, as a person counts them.
      [`${CONTRACT}, ,c1`, 3],
      [`0X${"ab".repeat(20)}`, 1],
      [`0x${"AB".repeat(20)}`, 1],
      [`${CONTRACT};${OTHER}`, 1],
      [`${CONTRACT} ${OTHER}`, 1],
      ["**", 1],
    ];
    for (const [value, entry] of lists) {
      const message = thrown(() => writeAllowlist({ AVAKIT_WRITE_ALLOWLIST: value }));
      expect(message, value).toBe(unreadableList(entry));
      expect(message).not.toContain("0x1234");
    }
  });
});

describe("AVAKIT_MAX_VALUE, as the server reads it", () => {
  it("is 0.1 AVAX while it is not set", () => {
    expect(DEFAULT_MAX_VALUE).toBe("0.1");
    for (const value of [undefined, "", "   "]) {
      expect(maxValue({ AVAKIT_MAX_VALUE: value }), String(value)).toBe(parseEther("0.1"));
    }
  });

  it("takes a decimal amount of AVAX, down to one wei, and 0 for none at all", () => {
    const amounts: [string, bigint][] = [
      ["0", 0n],
      ["1", AVAX],
      ["0.5", AVAX / 2n],
      [" 2.25 ", 2_250_000_000_000_000_000n],
      ["0.000000000000000001", 1n],
      ["1000000", 10n ** 24n],
    ];
    for (const [value, wei] of amounts) {
      expect(maxValue({ AVAKIT_MAX_VALUE: value }), value).toBe(wei);
    }
  });

  it("refuses anything else, without repeating it", () => {
    const key = `0x${"ab".repeat(32)}`;
    for (const value of [
      "-1",
      "+1",
      "1e18",
      "abc",
      "1.2.3",
      "0x10",
      ".5",
      "1.",
      // More decimals than a wei can tell apart, which would be rounded.
      "0.1234567890123456789",
      "0,5",
      "1 000",
      "Infinity",
      // A key pasted into the wrong variable is not quoted back.
      key,
    ]) {
      expect(
        thrown(() => maxValue({ AVAKIT_MAX_VALUE: value })),
        value,
      ).toBe(UNREADABLE_VALUE);
    }
    expect(thrown(() => maxValue({ AVAKIT_MAX_VALUE: key }))).not.toContain(key.slice(2));
  });
});

// ── Through the tools ────────────────────────────────────────────────────────

describe("on a fresh server", () => {
  let mcp: Connection;
  let net: FakeNetwork;
  let limits: typeof import("./limits.js");
  let wallets: typeof import("./wallet.js");
  let sending: typeof import("./send.js");

  beforeEach(async () => {
    vi.resetModules();
    const network = await import("./testing/network.js");
    net = network.fakeNetwork();
    network.fakeClock();
    // The same modules the server below is built from, so they share its state.
    limits = await import("./limits.js");
    wallets = await import("./wallet.js");
    sending = await import("./send.js");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const variable of [
      "AVAKIT_DEPLOYER_KEY",
      "AVAKIT_TEST_WALLET",
      "AVAKIT_ALLOW_MAINNET",
      "AVAKIT_FAUCET_URL",
      "AVAKIT_MCP_ROOT",
      "AVAKIT_WRITE_ALLOWLIST",
      "AVAKIT_MAX_VALUE",
    ]) {
      vi.stubEnv(variable, "");
    }
    mcp = await (await import("./testing/connect.js")).connect();
  });
  afterEach(async () => {
    await mcp.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Sign with a key of the user's own, funded on both chains. */
  function useOwnKey(): void {
    const key = generatePrivateKey();
    const { address } = privateKeyToAccount(key);
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", key);
    for (const node of [net.fuji, net.cChain]) node.setBalance(address, 10n * AVAX);
  }

  const mint = (address: string, extra: Record<string, unknown> = {}) =>
    mcp.call("write_contract", { address, abi: MINT, functionName: "mint", ...extra });

  describe("which contracts write_contract calls", () => {
    it("refuses one this server did not deploy and the environment does not list, before asking anything", async () => {
      // The session test wallet, empty: a call that went as far as funding it
      // would have asked the faucet first.
      net.fuji.setCode(CONTRACT);
      const result = await mint(CONTRACT);
      expect(result.isError).toBe(true);
      expect(result.text).toBe(refusedCall(CONTRACT));
      expect(net.fuji.calls).toEqual([]);
      expect(net.faucet.requests).toEqual([]);
      expect(net.strays).toEqual([]);
    });

    it("calls the contract deploy_contract deployed in this session, on that chain and no other", async () => {
      // Both mainnet gates open, so on the C-Chain only the list stands in the way.
      useOwnKey();
      vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
      const deployed = await mcp.call("deploy_contract", DEPLOY);
      expect(deployed.isError).toBe(false);
      const { address } = deployed.json<{ address: string }>();

      expect((await mint(address)).isError).toBe(false);
      // In lowercase, the way a node reports it, it is the same contract.
      expect((await mint(address.toLowerCase())).isError).toBe(false);
      const contract = address.toLowerCase();
      expect(net.fuji.sent.map((sent) => sent.to)).toEqual([null, contract, contract]);

      // The same address on the C-Chain is another account: nothing was deployed there.
      net.cChain.setCode(address);
      const elsewhere = await mint(address, { chain: "c-chain", confirm: true });
      expect(elsewhere.isError).toBe(true);
      expect(elsewhere.text).toBe(refusedCall(address, "Avalanche C-Chain"));
      expect(net.cChain.calls).toEqual([]);
    });

    it("calls the contract a session test wallet deployed, which is the README's flow", async () => {
      const deployed = await mcp.call("deploy_contract", DEPLOY);
      expect(deployed.json()).toMatchObject({ signer: { source: "session" } });
      const minted = await mint(deployed.json<{ address: string }>().address);
      expect(minted.isError).toBe(false);
      expect(net.fuji.sent).toHaveLength(2);
      expect(net.faucet.requests).toHaveLength(1);
    });

    it("calls a contract whose deployment was still pending when deploy_contract answered", async () => {
      // It is recorded when it is signed, so an agent that was told where the
      // contract will be can call it once it is there.
      useOwnKey();
      net.fuji.neverMine = true;
      const pending = await mcp.call("deploy_contract", DEPLOY);
      expect(pending.isError).toBe(true);
      const [, address = ""] =
        /the contract will be at (0x[0-9a-fA-F]{40})/.exec(pending.text) ?? [];
      expect(address).toBe(getAddress(net.fuji.sent[0]?.created ?? ""));

      net.fuji.neverMine = false;
      const minted = await mint(address);
      expect(minted.isError).toBe(false);
      expect(net.fuji.sent[1]).toMatchObject({ to: address.toLowerCase(), data: "0x1249c58b" });
    });

    it("calls the contracts AVAKIT_WRITE_ALLOWLIST lists, however they are capitalised", async () => {
      useOwnKey();
      for (const address of [CHECKSUMMED, CONTRACT, OTHER]) net.fuji.setCode(address);
      vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", ` ${CHECKSUMMED.toLowerCase()}, ${CONTRACT} `);
      for (const address of [CHECKSUMMED, CHECKSUMMED.toLowerCase(), CONTRACT]) {
        const result = await mint(address);
        expect(result.isError, address).toBe(false);
      }
      const unlisted = await mint(OTHER);
      expect(unlisted.text).toBe(refusedCall(OTHER));
      expect(net.fuji.sent).toHaveLength(3);
    });

    it("calls any contract when AVAKIT_WRITE_ALLOWLIST is *", async () => {
      useOwnKey();
      vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", "*");
      for (const address of [CONTRACT, OTHER, CHECKSUMMED]) {
        net.fuji.setCode(address);
        expect((await mint(address)).isError, address).toBe(false);
      }
      expect(net.fuji.sent).toHaveLength(3);
    });

    it("holds a mainnet call to the list as well, after the mainnet gates and not instead of them", async () => {
      useOwnKey();
      net.cChain.setCode(CONTRACT);
      // The gates answer first, as they always have.
      expect((await mint(CONTRACT, { chain: "c-chain" })).text).toBe(
        "Refusing to send a transaction on Avalanche C-Chain (mainnet) without confirm:true.",
      );
      expect((await mint(CONTRACT, { chain: "c-chain", confirm: true })).text).toContain(
        "set AVAKIT_ALLOW_MAINNET=1 in the server environment",
      );
      vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
      const unlisted = await mint(CONTRACT, { chain: "c-chain", confirm: true });
      expect(unlisted.text).toBe(refusedCall(CONTRACT, "Avalanche C-Chain"));
      expect(net.cChain.calls).toEqual([]);

      vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", CONTRACT);
      const listed = await mint(CONTRACT, { chain: "c-chain", confirm: true });
      expect(listed.isError).toBe(false);
      expect(net.cChain.sent).toHaveLength(1);
      expect(net.fuji.calls).toEqual([]);
    });

    it("calls nothing while AVAKIT_WRITE_ALLOWLIST cannot be read, and deploys as before", async () => {
      useOwnKey();
      vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", `${CONTRACT},0x1234`);
      const deployed = await mcp.call("deploy_contract", DEPLOY);
      expect(deployed.isError).toBe(false);
      // Not even the contract it just deployed: the list says something it cannot read.
      for (const address of [deployed.json<{ address: string }>().address, CONTRACT]) {
        const result = await mint(address);
        expect(result.text, address).toBe(unreadableList(2));
      }
      expect(net.fuji.sent).toHaveLength(1);
    });
  });

  describe("how much AVAX one call sends", () => {
    // Your own key: the session test wallet sends none at all (session.test.ts).
    beforeEach(() => {
      useOwnKey();
      net.fuji.setCode(CONTRACT);
      vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", CONTRACT);
    });

    const buy = (wei: bigint) =>
      mcp.call("write_contract", {
        address: CONTRACT,
        abi: BUY,
        functionName: "buy",
        value: wei.toString(),
      });

    it("sends up to 0.1 AVAX by default, and refuses one wei more before asking the chain", async () => {
      const limit = parseEther("0.1");
      expect((await buy(limit)).isError).toBe(false);
      expect(net.fuji.sent[0]?.value).toBe(limit);

      const asked = net.fuji.calls.length;
      const over = await buy(limit + 1n);
      expect(over.isError).toBe(true);
      expect(over.text).toBe(refusedValue("0.100000000000000001", "0.1", "default"));
      expect(net.fuji.calls).toHaveLength(asked);
      expect(net.fuji.sent).toHaveLength(1);
    });

    it("sends what AVAKIT_MAX_VALUE allows, and with 0 nothing at all", async () => {
      vi.stubEnv("AVAKIT_MAX_VALUE", "1.5");
      expect((await buy(parseEther("1.5"))).isError).toBe(false);
      expect((await buy(parseEther("1.5") + 1n)).text).toBe(
        refusedValue("1.500000000000000001", "1.5", "env"),
      );

      vi.stubEnv("AVAKIT_MAX_VALUE", "0");
      expect((await buy(1n)).text).toBe(refusedValue("0.000000000000000001", "0", "env"));
      // A call that sends nothing is not held back by it.
      expect((await mint(CONTRACT)).isError).toBe(false);
      expect(net.fuji.sent.map((sent) => sent.value)).toEqual([parseEther("1.5"), 0n]);
    });

    it("is a refusal of its own only where value could be sent at all", async () => {
      // A function that is not payable, and mainnet, refuse value whatever the limit.
      vi.stubEnv("AVAKIT_MAX_VALUE", "0");
      const notPayable = await mcp.call("write_contract", {
        address: CONTRACT,
        abi: MINT,
        functionName: "mint",
        value: "1",
      });
      expect(notPayable.text).toBe(
        '"mint" is not payable, so it cannot be sent AVAX. Leave value out.',
      );
      vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
      const mainnet = await mcp.call("write_contract", {
        address: CONTRACT,
        abi: BUY,
        functionName: "buy",
        value: "1",
        chain: "c-chain",
        confirm: true,
      });
      expect(mainnet.text).toBe(
        "write_contract does not send AVAX on Avalanche C-Chain (mainnet): value is for testnets only.",
      );
    });

    it("signs nothing while AVAKIT_MAX_VALUE cannot be read, deploys included, and asks neither the chain nor the faucet", async () => {
      vi.stubEnv("AVAKIT_MAX_VALUE", "0,5");
      for (const result of [
        await buy(1n),
        await mint(CONTRACT),
        await mcp.call("deploy_contract", DEPLOY),
      ]) {
        expect(result.isError).toBe(true);
        expect(result.text).toBe(UNREADABLE_VALUE);
      }
      // The session test wallet, empty, which would otherwise ask the faucet first.
      vi.stubEnv("AVAKIT_DEPLOYER_KEY", "");
      expect((await mcp.call("deploy_contract", DEPLOY)).text).toBe(UNREADABLE_VALUE);
      expect(net.fuji.calls).toEqual([]);
      expect(net.faucet.requests).toEqual([]);
    });
  });

  describe("the signer", () => {
    const transaction = (overrides: Partial<UnsignedTransaction> = {}): UnsignedTransaction => ({
      chainId: fuji.id,
      nonce: 0,
      gas: 100_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      data: "0x1249c58b",
      value: 0n,
      ...overrides,
    });

    it("will not sign a call the limits do not allow, whichever wallet it is", async () => {
      const own = wallets.resolveSigner(fuji, { AVAKIT_DEPLOYER_KEY: generatePrivateKey() });
      const session = wallets.resolveSigner(fuji, {});
      expect(session.source).toBe("session");
      for (const signer of [own, session]) {
        await expect(signer.signTransaction(transaction({ to: CONTRACT }))).rejects.toThrow(
          refusedCall(CONTRACT),
        );
        // A creation goes to no contract, and is signed.
        await expect(signer.signTransaction(transaction({ data: "0x6080" }))).resolves.toMatch(
          /^0x02/,
        );
      }

      // Once the contract is one this process deployed on Fuji, both sign a call to it.
      limits.recordDeployment(fuji.id, CONTRACT);
      for (const signer of [own, session]) {
        await expect(signer.signTransaction(transaction({ to: CONTRACT }))).resolves.toMatch(
          /^0x02/,
        );
      }
      // And no more AVAX than one call may send.
      await expect(
        own.signTransaction(transaction({ to: CONTRACT, value: parseEther("0.1") + 1n })),
      ).rejects.toThrow(refusedValue("0.100000000000000001", "0.1", "default"));
      await expect(
        own.signTransaction(transaction({ to: CONTRACT, value: parseEther("0.1") })),
      ).resolves.toMatch(/^0x02/);
    });

    it("holds a send that skipped the tools' check, so nothing goes out", async () => {
      const key = generatePrivateKey();
      net.fuji.setBalance(privateKeyToAccount(key).address, 10n * AVAX);
      net.fuji.setCode(CONTRACT);
      const signer = wallets.resolveSigner(fuji, { AVAKIT_DEPLOYER_KEY: key });
      await expect(
        sending.send(fuji, signer, { kind: "transaction", to: CONTRACT, data: "0x1249c58b" }),
      ).rejects.toThrow(refusedCall(CONTRACT));
      await expect(
        sending.send(fuji, signer, {
          kind: "transaction",
          to: CONTRACT,
          data: "0xa6f2ae3a",
          value: AVAX,
        }),
      ).rejects.toThrow(/^Refusing to call/);
      vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", CONTRACT);
      await expect(
        sending.send(fuji, signer, {
          kind: "transaction",
          to: CONTRACT,
          data: "0xa6f2ae3a",
          value: AVAX,
        }),
      ).rejects.toThrow(refusedValue("1", "0.1", "default"));
      expect(net.fuji.callsTo("eth_sendRawTransaction")).toEqual([]);
      expect(net.fuji.sent).toEqual([]);
    });
  });

  describe("what the tools and the README say about it", () => {
    it("tells the model which contracts write_contract calls and how much AVAX it sends", async () => {
      const { tools } = await mcp.client.listTools();
      const tool = (name: string) => tools.find((entry) => entry.name === name);
      const write = tool("write_contract");
      expect(write?.description).toContain(
        "It calls only a contract this server deployed in this session (with deploy_contract, on " +
          "the same chain) or one whose address AVAKIT_WRITE_ALLOWLIST lists in the server's " +
          "environment (AVAKIT_WRITE_ALLOWLIST=* allows any), and sends at most AVAKIT_MAX_VALUE " +
          `AVAX with a call (${DEFAULT_MAX_VALUE} when it is not set).`,
      );
      const options = write?.inputSchema.properties as Record<string, { description?: string }>;
      expect(options.address?.description).toContain("AVAKIT_WRITE_ALLOWLIST");
      expect(options.value?.description).toContain(
        `at most AVAKIT_MAX_VALUE AVAX (${DEFAULT_MAX_VALUE} unless the server sets it)`,
      );
      expect(tool("deploy_contract")?.description).toContain(
        "use write_contract, which may call a contract deployed here, on that chain, for as long as the server runs",
      );
      const { text } = await mcp.call("get_context");
      expect(text).toContain(
        "`write_contract` calls only the contracts this server deployed in this session (on the same " +
          "chain) and the ones `AVAKIT_WRITE_ALLOWLIST` lists in the server's environment, and one " +
          `call sends at most \`AVAKIT_MAX_VALUE\` AVAX (${DEFAULT_MAX_VALUE} when it is not set).`,
      );
    });

    it("documents the limits: the defaults, how to widen them, and why no file can", () => {
      const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
      const section = readme.slice(
        readme.indexOf("## Write limits"),
        readme.indexOf("## Scaffolding"),
      );
      for (const said of [
        "`AVAKIT_WRITE_ALLOWLIST=*`",
        `\`${DEFAULT_MAX_VALUE}\``,
        "Nothing was signed or sent.",
        "an injected agent can write files too",
        "forgotten when the server stops",
        "no daily limit",
      ]) {
        expect(section, said).toContain(said);
      }
      // The refusals the README quotes are the ones the server gives.
      expect(section).toContain(refusedCall(CHECKSUMMED));
      expect(section).toContain(refusedValue("0.5", "0.1", "default"));
    });
  });
});
