import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cChain, fuji } from "@avakit/core";
import { type Address, encodeErrorResult, getContractAddress, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deployOutcome } from "./deploy.js";
import { type Connection, connect } from "./testing/connect.js";
import { type FakeClock, type FakeNetwork, fakeClock, fakeNetwork } from "./testing/network.js";

const TX_HASH = `0x${"ab".repeat(32)}` as const;
const CONTRACT = "0x00000000000000000000000000000000000000C1" as const;

describe("deployOutcome", () => {
  it("returns the address and explorer link when the creation succeeded", () => {
    expect(deployOutcome({ status: "success", contractAddress: CONTRACT }, TX_HASH, fuji)).toEqual({
      ok: true,
      result: {
        address: CONTRACT,
        txHash: TX_HASH,
        explorerUrl: `${fuji.explorerUrl}/address/${CONTRACT}`,
      },
    });
  });

  it("is a failure when the transaction reverted, even though the receipt has an address", () => {
    // A node derives contractAddress from the sender and nonce for every
    // creation transaction, so a reverted one carries it too — with no code there.
    const outcome = deployOutcome({ status: "reverted", contractAddress: CONTRACT }, TX_HASH, fuji);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("reverted");
    expect(outcome.message).toContain(TX_HASH);
    expect(outcome.message).toContain(`${fuji.explorerUrl}/tx/${TX_HASH}`);
    expect(outcome.message).not.toContain(CONTRACT);
  });

  it("is a failure when the receipt has no contract address", () => {
    for (const contractAddress of [null, undefined]) {
      const outcome = deployOutcome({ status: "success", contractAddress }, TX_HASH, cChain);
      expect(outcome).toEqual({ ok: false, message: expect.stringContaining("contract address") });
    }
  });
});

// Deploys with the user's own key, AVAKIT_DEPLOYER_KEY: the path this tool has
// always had. (The session test wallet has its own file, session.test.ts.)
//
// No RPC is contacted and nothing is broadcast: `fetch` is replaced by a fake
// network (testing/network.ts), and everything on this side of it — viem, the
// signing, @avakit/core — is real.
describe("deploy_contract with AVAKIT_DEPLOYER_KEY", () => {
  let mcp: Connection;
  beforeAll(async () => {
    mcp = await connect();
  });
  afterAll(() => mcp.close());

  let net: FakeNetwork;
  let time: FakeClock;
  let deployer: Address;
  /** Where the deployer's first contract lands, the way a node returns it: lowercase. */
  let created: string;

  beforeEach(() => {
    net = fakeNetwork();
    time = fakeClock();
    // A fresh random key per test: never a literal, never written anywhere.
    const key = generatePrivateKey();
    deployer = privateKeyToAccount(key).address;
    created = getContractAddress({ from: deployer, nonce: 0n }).toLowerCase();
    net.fuji.setBalance(deployer, 10n ** 18n);
    net.cChain.setBalance(deployer, 10n ** 18n);
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", key);
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "");
    vi.stubEnv("AVAKIT_TEST_WALLET", "");
    vi.stubEnv("AVAKIT_MCP_ROOT", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const deploy = (args: Record<string, unknown> = {}) =>
    mcp.call("deploy_contract", { abi: [], bytecode: "0x6080", ...args });

  it("returns the deployed address for a successful creation, and says who signed", async () => {
    const result = await deploy();
    expect(result.isError).toBe(false);
    const [sent] = net.fuji.sent;
    expect(result.json()).toEqual({
      address: created,
      txHash: sent?.hash,
      explorerUrl: `${fuji.explorerUrl}/address/${created}`,
      // The user's own key: no note about a temporary wallet.
      signer: { address: deployer, source: "env" },
    });
    expect(net.fuji.sent).toHaveLength(1);
    expect(sent).toMatchObject({
      from: deployer,
      to: null,
      data: "0x6080",
      value: 0n,
      chainId: fuji.id,
      type: "eip1559",
    });
    // Its own key never goes near the faucet, and nothing else was contacted.
    expect(net.faucet.requests).toEqual([]);
    expect(net.cChain.calls).toEqual([]);
    expect(net.strays).toEqual([]);
  });

  it("reports a reverted creation as an error instead of a deployed contract", async () => {
    net.fuji.status = "reverted";
    const result = await deploy();
    // This returned { address, txHash, explorerUrl } with isError false: an
    // agent was told a contract existed at an address that holds no code.
    expect(result.isError).toBe(true);
    expect(result.text).toContain("reverted");
    expect(result.text).toContain(net.fuji.sent[0]?.hash);
    expect(result.text.toLowerCase()).not.toContain(created);
  });

  it("reports a receipt without a contract address as an error", async () => {
    net.fuji.omitContractAddress = true;
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("contract address");
  });

  it("refuses, before sending anything, when the deployer has no funds", async () => {
    net.fuji.setBalance(deployer, 0n);
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/has no AVAX on Avalanche Fuji/);
    expect(net.fuji.sent).toEqual([]);
    // The faucet funds the session test wallet, not a wallet of the user's.
    expect(net.faucet.requests).toEqual([]);
  });

  it("refuses when the deployer holds something, but less than the deployment costs", async () => {
    // Only an empty wallet was caught before. One with a little in it went on to
    // the node, which answered with "insufficient funds for gas * price + value".
    net.fuji.gasEstimate = 1_000_000n;
    net.fuji.setBalance(deployer, 10n ** 14n);
    const result = await deploy();
    expect(result.isError).toBe(true);
    // gas 1,000,000 × (1.2 × 1 nAVAX base fee + 0.5 nAVAX tip) = 0.0017 AVAX
    expect(result.text).toContain(`Deployer ${deployer} has 0.0001 AVAX on Avalanche Fuji`);
    expect(result.text).toContain("needs about 0.0017 AVAX");
    expect(result.text).toContain("nothing was sent");
    expect(net.fuji.sent).toEqual([]);
    expect(net.faucet.requests).toEqual([]);
  });

  it("refuses when no deployer key is configured and the session test wallet is off", async () => {
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", "");
    vi.stubEnv("AVAKIT_TEST_WALLET", "0");
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("AVAKIT_DEPLOYER_KEY");
    expect(result.text).toContain("AVAKIT_TEST_WALLET=0");
    expect(net.fuji.calls).toEqual([]);
  });

  it("refuses mainnet unless both the caller and the server environment allow it", async () => {
    const unconfirmed = await deploy({ chain: "c-chain" });
    expect(unconfirmed.isError).toBe(true);
    expect(unconfirmed.text).toContain("without confirm:true");

    // confirm:true is something a prompt can talk an agent into; the env is not.
    const confirmedOnly = await deploy({ chain: "c-chain", confirm: true });
    expect(confirmedOnly.isError).toBe(true);
    expect(confirmedOnly.text).toContain("AVAKIT_ALLOW_MAINNET=1");
    expect(net.cChain.calls).toEqual([]);

    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    const allowed = await deploy({ chain: "c-chain", confirm: true });
    expect(allowed.isError).toBe(false);
    expect(allowed.json()).toMatchObject({
      explorerUrl: `${cChain.explorerUrl}/address/${created}`,
      signer: { address: deployer, source: "env" },
    });
    expect(net.cChain.sent).toHaveLength(1);
    expect(net.cChain.sent[0]?.chainId).toBe(cChain.id);
    expect(net.fuji.calls).toEqual([]);
  });

  it("rejects bytecode that is not hex", async () => {
    const result = await deploy({ bytecode: "0xnothex" });
    expect(result.isError).toBe(true);
    expect(net.fuji.calls).toEqual([]);
  });

  it("refuses a key that is not one, without repeating it", async () => {
    const malformed = `0x${"zz".repeat(32)}`;
    // Sixty-four hex digits, but not a key on the curve: the library's own
    // message for this one prints the number.
    const outOfRange = `0x${"ff".repeat(32)}`;
    for (const value of [malformed, outOfRange, "0x1234", "not a key"]) {
      vi.stubEnv("AVAKIT_DEPLOYER_KEY", value);
      const result = await deploy();
      expect(result.isError, value).toBe(true);
      expect(result.text).toContain("AVAKIT_DEPLOYER_KEY is not a valid private key");
      expect(result.text).not.toContain(value);
      expect(result.text).not.toContain(value.slice(2));
      expect(result.text).not.toContain(BigInt(outOfRange).toString());
    }
    expect(net.fuji.calls).toEqual([]);
  });

  it("accepts a key without the 0x prefix, as wallets export it", async () => {
    const key = generatePrivateKey();
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", key.slice(2));
    const exported = privateKeyToAccount(key).address;
    net.fuji.setBalance(exported, 10n ** 18n);
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(result.json()).toMatchObject({ signer: { address: exported, source: "env" } });
  });

  it("does not report an address until there is code at it", async () => {
    // A block is accepted before it is executed, so right after the receipt a
    // node can still answer "no code". Three empty answers, then the code.
    net.fuji.codeDelay = 3;
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(result.json()).toMatchObject({ address: created });
    expect(net.fuji.callsTo("eth_getCode")).toHaveLength(4);
    expect(time.sleeps.filter((ms) => ms === 400).length).toBeGreaterThanOrEqual(3);
  });

  it("reports a creation that left no code behind as an error", async () => {
    // What deploying the runtime bytecode does: mined, status success, and an
    // empty account at the address. It used to be returned as a deployed contract.
    net.fuji.emptyCreations = true;
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("there is no contract code at");
    expect(result.text).toContain("creation bytecode");
    expect(result.text).toContain(`${fuji.explorerUrl}/tx/${net.fuji.sent[0]?.hash}`);
    // Read six times over two seconds before giving up.
    expect(net.fuji.callsTo("eth_getCode")).toHaveLength(6);
  });

  it("returns a constructor's revert reason without sending anything", async () => {
    net.fuji.estimateFailure = {
      code: 3,
      message: "execution reverted: owner is the zero address",
      data: encodeErrorResult({
        abi: parseAbi(["error Error(string)"]),
        errorName: "Error",
        args: ["owner is the zero address"],
      }),
    };
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'This deployment would revert on Avalanche Fuji, so nothing was sent. Reason: "owner is the zero address".',
    );
    expect(net.fuji.sent).toEqual([]);
  });

  it("checks the constructor arguments against the ABI before anything is sent", async () => {
    // viem appends nothing when the arguments are missing, and the creation
    // then reverts on chain with no reason.
    const abi = ["constructor(address teleporter, uint256 cap)"];
    const missing = await deploy({ abi });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe(
      "The constructor takes 2 arguments, constructor(address teleporter, uint256 cap), but args has 0.",
    );

    const extra = await deploy({ args: [1] });
    expect(extra.isError).toBe(true);
    expect(extra.text).toContain("takes no arguments, but args has 1");
    expect(net.fuji.calls).toEqual([]);

    const given = await deploy({
      abi,
      // A uint256 too large for a JSON number, passed the way it has to be.
      args: ["0x00000000000000000000000000000000000000aa", "1000000000000000000000001"],
    });
    expect(given.isError).toBe(false);
    expect(net.fuji.sent[0]?.data).toBe(
      `0x6080${"00".repeat(12)}${"00".repeat(19)}aa${1000000000000000000000001n.toString(16).padStart(64, "0")}`,
    );
  });

  it("refuses to sign when the RPC turns out to be another chain", async () => {
    net.fuji.chainId = cChain.id;
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      `The RPC for Avalanche Fuji answers as chain ${cChain.id}, not ${fuji.id}. Nothing was signed.`,
    );
    expect(net.fuji.sent).toEqual([]);
  });

  it("says that nothing was sent when the RPC cannot be reached", async () => {
    net.fuji.down = true;
    const result = await deploy();
    expect(result.isError).toBe(true);
    // One line, not viem's dump of the URL and the request body.
    expect(result.text).toBe(
      `Could not reach Avalanche Fuji (${fuji.rpcUrl}), so nothing was sent: the RPC could not be reached (fetch failed)`,
    );
    // The read was tried more than once before giving up; nothing was signed.
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
    expect(net.fuji.sent).toEqual([]);
  }, 15_000);

  it("says what the RPC answered when it is up but failing", async () => {
    net.fuji.httpStatus = 503;
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      `Could not reach Avalanche Fuji (${fuji.rpcUrl}), so nothing was sent: the RPC answered HTTP 503`,
    );
  }, 15_000);

  it("reports a transaction that is not mined in time as pending, with where the contract will be", async () => {
    net.fuji.neverMine = true;
    const result = await deploy();
    expect(result.isError).toBe(true);
    const hash = net.fuji.sent[0]?.hash;
    expect(result.text).toContain(`Transaction ${hash} was sent`);
    expect(result.text).toContain("had not confirmed it after 60 seconds");
    expect(result.text).toContain("so that it is not done twice");
    expect(result.text).toContain(`${fuji.explorerUrl}/tx/${hash}`);
    expect(result.text).toContain(
      `the contract will be at ${getContractAddress({ from: deployer, nonce: 0n })}`,
    );
    // It waited the whole minute and sent once: a deploy is never re-sent.
    expect(time.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(60_000);
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("waits for a receipt that takes a few polls", async () => {
    net.fuji.receiptDelay = 4;
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(net.fuji.callsTo("eth_getTransactionReceipt")).toHaveLength(5);
  });

  it("recognises its own transaction when the broadcast's answer is lost", async () => {
    // The node took it; the connection dropped before it said so. That used to
    // read as a failed deploy — and an agent that tries again deploys a second
    // contract. Now the node is asked whether it has the transaction.
    net.fuji.loseAnswerTo = "eth_sendRawTransaction";
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(result.json()).toMatchObject({ address: created, txHash: net.fuji.sent[0]?.hash });
    expect(net.fuji.sent).toHaveLength(1);
    expect(net.fuji.callsTo("eth_getTransactionByHash")).toEqual([[net.fuji.sent[0]?.hash]]);
  });

  it("recognises its own transaction when the node says it has seen it before", async () => {
    // What a node answers to the second copy of a transaction it already holds.
    net.fuji.override("eth_sendRawTransaction", async ([raw]) => {
      await net.fuji.accept(raw as `0x${string}`);
      throw { code: -32000, message: "already known" };
    });
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("reports a transaction the node rejects as not sent", async () => {
    net.fuji.override("eth_sendRawTransaction", () => {
      throw { code: -32000, message: "transaction underpriced" };
    });
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Avalanche Fuji rejected this deployment, so nothing was sent: transaction underpriced",
    );
    expect(net.fuji.sent).toEqual([]);
  });

  it("does not claim to know what became of a transaction whose broadcast failed on the way", async () => {
    // The connection failed and the node does not list the transaction. It
    // most likely never arrived — but "nothing was sent" would be a guess, so
    // the hash is given for someone to check before the deploy is repeated.
    net.fuji.override("eth_sendRawTransaction", () => {
      throw new TypeError("fetch failed");
    });
    const result = await deploy();
    expect(result.isError).toBe(true);
    const [, hash] = /Its hash would be (0x[0-9a-f]{64}):/.exec(result.text) ?? [];
    expect(result.text).toBe(
      "It is not certain whether this deployment went out: sending it to Avalanche Fuji failed " +
        `(the RPC could not be reached (fetch failed)). Its hash would be ${hash}: check ` +
        `${fuji.explorerUrl}/tx/${hash} before trying again, so that it is not sent twice.`,
    );
    expect(result.text).not.toContain("nothing was sent");
    expect(net.fuji.sent).toEqual([]);

    // The same when the node says "nonce too low" and then cannot be asked
    // whether the transaction it means is this one.
    net.fuji.override("eth_sendRawTransaction", () => {
      throw { code: -32000, message: "nonce too low" };
    });
    net.fuji.override("eth_getTransactionByHash", () => {
      throw { code: -32000, message: "server is overloaded" };
    });
    const unsure = await deploy();
    expect(unsure.text).toContain("It is not certain whether this deployment went out");
    expect(unsure.text).toContain("(nonce too low)");
  });

  it("takes two deploys that arrive together one at a time", async () => {
    // Side by side they read the same nonce, and the node refuses the second.
    const [first, second] = await Promise.all([deploy(), deploy()]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(net.fuji.sent.map((sent) => sent.nonce)).toEqual([0, 1]);
    expect(first.json<{ address: string }>().address).not.toBe(
      second.json<{ address: string }>().address,
    );
  });

  it("does not reuse a nonce while the node still reports the old count", async () => {
    // Right after a receipt, a node's "pending" count can lag by a read or two.
    net.fuji.nonceLag = 12;
    expect((await deploy()).isError).toBe(false);
    expect((await deploy()).isError).toBe(false);
    expect(net.fuji.sent.map((sent) => sent.nonce)).toEqual([0, 1]);
  });

  describe("given the contract as a file", () => {
    // <base>/work stands in for the server's working directory.
    let base: string;
    let cwd: string;

    beforeEach(() => {
      base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-deploy-")));
      cwd = path.join(base, "work");
      mkdirSync(path.join(cwd, "out"), { recursive: true });
      vi.spyOn(process, "cwd").mockReturnValue(cwd);
      writeFileSync(
        path.join(cwd, "out", "Counter.json"),
        JSON.stringify({
          abi: [{ type: "constructor", inputs: [{ name: "start", type: "uint256" }] }],
          bytecode: { object: "0x60a0" },
        }),
      );
    });
    afterEach(() => rmSync(base, { recursive: true, force: true }));

    it("deploys the bytecode in the file, with the constructor arguments encoded by its ABI", async () => {
      const result = await mcp.call("deploy_contract", {
        artifactPath: "out/Counter.json",
        args: [7],
      });
      expect(result.isError).toBe(false);
      expect(net.fuji.sent[0]?.data).toBe(`0x60a0${"00".repeat(31)}07`);
    });

    it("takes the contract one way or the other, never both and never neither", async () => {
      const both = await mcp.call("deploy_contract", {
        artifactPath: "out/Counter.json",
        abi: [],
        bytecode: "0x6080",
      });
      expect(both.isError).toBe(true);
      expect(both.text).toContain("as artifactPath, or as abi and bytecode — not both");

      for (const args of [{}, { abi: [] }, { bytecode: "0x6080" }]) {
        const neither = await mcp.call("deploy_contract", args);
        expect(neither.isError, JSON.stringify(args)).toBe(true);
        expect(neither.text).toContain("pass artifactPath");
        expect(neither.text).toContain("or both abi and bytecode");
      }
      expect(net.fuji.calls).toEqual([]);
    });

    it("refuses a file outside the working directory", async () => {
      writeFileSync(path.join(base, "outside.json"), JSON.stringify({ abi: [], bytecode: "0x60" }));
      const result = await mcp.call("deploy_contract", { artifactPath: "../outside.json" });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Refusing to read "../outside.json"');
      expect(net.fuji.calls).toEqual([]);
    });

    it("refuses an artifact that has no bytecode to deploy", async () => {
      writeFileSync(path.join(cwd, "out", "IThing.json"), JSON.stringify({ abi: [] }));
      const result = await mcp.call("deploy_contract", { artifactPath: "out/IThing.json" });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("has an ABI but no creation bytecode");
      expect(net.fuji.calls).toEqual([]);
    });
  });
});
