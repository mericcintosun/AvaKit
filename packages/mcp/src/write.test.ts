import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cChain, fuji } from "@avakit/core";
import { type Address, encodeErrorResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Connection, connect } from "./testing/connect.js";
import { type FakeClock, type FakeNetwork, fakeClock, fakeNetwork } from "./testing/network.js";

const CONTRACT = "0x00000000000000000000000000000000000000c1";
const ALICE = "0x00000000000000000000000000000000000000aa";
const MINT = ["function mint() returns (uint256)"];

// write_contract with the user's own key. (With no key at all, see session.test.ts.)
//
// As in deploy.test.ts, the network is fake and everything on this side of it
// is real: each transaction is signed for real, and the fake node decodes it.
describe("write_contract", () => {
  let mcp: Connection;
  beforeAll(async () => {
    mcp = await connect();
  });
  afterAll(() => mcp.close());

  let net: FakeNetwork;
  let time: FakeClock;
  let wallet: Address;

  beforeEach(() => {
    net = fakeNetwork();
    time = fakeClock();
    const key = generatePrivateKey();
    wallet = privateKeyToAccount(key).address;
    for (const node of [net.fuji, net.cChain]) {
      node.setBalance(wallet, 10n ** 18n);
      node.setCode(CONTRACT);
    }
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

  const write = (args: Record<string, unknown> = {}) =>
    mcp.call("write_contract", { address: CONTRACT, abi: MINT, functionName: "mint", ...args });

  it("sends the call, waits for it to succeed, and says who signed", async () => {
    const result = await write();
    expect(result.isError).toBe(false);
    const [sent] = net.fuji.sent;
    expect(result.json()).toEqual({
      txHash: sent?.hash,
      status: "success",
      blockNumber: "1001",
      explorerUrl: `${fuji.explorerUrl}/tx/${sent?.hash}`,
      signer: { address: wallet, source: "env" },
    });
    expect(net.fuji.sent).toHaveLength(1);
    expect(sent).toMatchObject({
      from: wallet,
      to: CONTRACT,
      data: "0x1249c58b",
      value: 0n,
      chainId: fuji.id,
      type: "eip1559",
    });
    // Simulated as the wallet that will send it, before it was sent.
    const [call] = net.fuji.callsTo("eth_call");
    expect(call?.[0]).toMatchObject({ from: wallet, to: CONTRACT, data: "0x1249c58b" });
    const methods = net.fuji.calls.map((entry) => entry.method);
    expect(methods.indexOf("eth_call")).toBeLessThan(methods.indexOf("eth_sendRawTransaction"));
    expect(net.faucet.requests).toEqual([]);
    expect(net.cChain.calls).toEqual([]);
    expect(net.strays).toEqual([]);
  });

  it("returns a simulation's revert reason without sending anything", async () => {
    net.fuji.callFailure = {
      code: 3,
      message: "execution reverted: AvaKitNFT: sold out",
      data: encodeErrorResult({
        abi: parseAbi(["error Error(string)"]),
        errorName: "Error",
        args: ["AvaKitNFT: sold out"],
      }),
    };
    const result = await write();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'Simulating mint() on Avalanche Fuji reverted, so nothing was sent. Reason: "AvaKitNFT: sold out".',
    );
    expect(net.fuji.sent).toEqual([]);
    // It stopped at the simulation: no gas estimate, no signature, no broadcast.
    expect(net.fuji.callsTo("eth_estimateGas")).toEqual([]);
    expect(net.fuji.callsTo("eth_sendRawTransaction")).toEqual([]);
  });

  it("names a contract's own error when the ABI has it", async () => {
    const abi = ["function mint() returns (uint256)", "error SoldOut(uint256 max, address who)"];
    net.fuji.callFailure = {
      code: 3,
      message: "execution reverted",
      data: encodeErrorResult({ abi: parseAbi(abi), errorName: "SoldOut", args: [100n, ALICE] }),
    };
    const known = await write({ abi });
    expect(known.text).toBe(
      // Decoded values come back the way viem writes them: an address checksummed.
      `Simulating mint() on Avalanche Fuji reverted, so nothing was sent. Reason: custom error SoldOut(100, ${getAddress(ALICE)}).`,
    );

    // The same revert, with an ABI that does not list the error.
    const unknown = await write();
    expect(unknown.text).toBe(
      "Simulating mint() on Avalanche Fuji reverted, so nothing was sent. " +
        `Reason: an error that is not in the ABI (selector ${net.fuji.callFailure.data?.slice(0, 10)}).`,
    );
    expect(net.fuji.sent).toEqual([]);
  });

  it("explains a revert that comes with no reason at all", async () => {
    net.fuji.callFailure = { code: -32000, message: "execution reverted" };
    const result = await write();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Simulating mint() on Avalanche Fuji reverted, so nothing was sent. Reason: no reason given. " +
        `A contract also reverts this way when it has no function "mint": check that the ABI belongs to the contract at ${CONTRACT}.`,
    );
  });

  it("reports a transaction that reverts on chain as an error, not as a success", async () => {
    // The simulation passes; by the time the transaction is mined it does not.
    net.fuji.status = "reverted";
    const result = await write();
    expect(result.isError).toBe(true);
    const hash = net.fuji.sent[0]?.hash;
    expect(result.text).toContain(`Transaction ${hash} was mined on Avalanche Fuji but reverted`);
    expect(result.text).toContain("so nothing changed");
    expect(result.text).toContain(`${fuji.explorerUrl}/tx/${hash}`);
    expect(result.text).not.toContain('"status"');
  });

  it("refuses mainnet unless both the caller and the server environment allow it, exactly as a deploy is", async () => {
    const unconfirmed = await write({ chain: "c-chain" });
    expect(unconfirmed.isError).toBe(true);
    expect(unconfirmed.text).toBe(
      "Refusing to send a transaction on Avalanche C-Chain (mainnet) without confirm:true.",
    );

    // confirm:true is something a prompt can talk an agent into; the env is not.
    for (const value of ["", "0", "true"]) {
      vi.stubEnv("AVAKIT_ALLOW_MAINNET", value);
      const confirmedOnly = await write({ chain: "c-chain", confirm: true });
      expect(confirmedOnly.isError).toBe(true);
      expect(confirmedOnly.text).toBe(
        "Refusing to send a transaction on Avalanche C-Chain (mainnet): set AVAKIT_ALLOW_MAINNET=1 in the " +
          "server environment to allow mainnet transactions. This out-of-band gate cannot be set by a tool caller.",
      );
    }
    // The environment alone is not enough either.
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    const envOnly = await write({ chain: "c-chain" });
    expect(envOnly.text).toContain("without confirm:true");
    expect(net.cChain.calls).toEqual([]);

    const allowed = await write({ chain: "c-chain", confirm: true });
    expect(allowed.isError).toBe(false);
    expect(allowed.json()).toMatchObject({
      status: "success",
      explorerUrl: `${cChain.explorerUrl}/tx/${net.cChain.sent[0]?.hash}`,
      signer: { address: wallet, source: "env" },
    });
    expect(net.cChain.sent).toHaveLength(1);
    expect(net.cChain.sent[0]).toMatchObject({ chainId: cChain.id, from: wallet, value: 0n });
    expect(net.fuji.calls).toEqual([]);
  });

  it("refuses to call an address that has no contract at it", async () => {
    // A call to an empty account is mined and "succeeds" having done nothing.
    const empty = "0x00000000000000000000000000000000000000ee";
    const result = await write({ address: empty });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      `There is no contract at ${empty} on Avalanche Fuji, so nothing was sent. Check the address ` +
        "(deploy_contract returns it) and that this is the chain it was deployed to.",
    );
    expect(net.fuji.sent).toEqual([]);
    // Looked several times first: code can take a moment to show after a deploy.
    expect(net.fuji.callsTo("eth_getCode")).toHaveLength(6);
    expect(time.sleeps).toEqual([400, 400, 400, 400, 400]);
  });

  it("refuses a read-only function, and a function that is not there, before asking the chain", async () => {
    const abi = [
      "function mint() returns (uint256)",
      "function burn(uint256 tokenId)",
      "function ownerOf(uint256 tokenId) view returns (address)",
    ];
    const view = await write({ abi, functionName: "ownerOf", args: [1] });
    expect(view.isError).toBe(true);
    expect(view.text).toContain('"ownerOf" is a read-only (view) function');
    expect(view.text).toContain("read_chain");

    const missing = await write({ abi, functionName: "transfer" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe(
      'No function "transfer" in the ABI. Its state-changing functions: mint(), burn(uint256 tokenId).',
    );

    const wrongCount = await write({ abi, functionName: "burn" });
    expect(wrongCount.text).toContain('"burn" does not take 0 arguments');
    expect(net.fuji.calls).toEqual([]);
  });

  it("encodes arguments exactly, and refuses a number that JSON has already rounded", async () => {
    const abi = ["function transfer(address to, uint256 amount) returns (bool)"];
    const amount = "1000000000000000000000001";
    const result = await write({ abi, functionName: "transfer", args: [ALICE, amount] });
    expect(result.isError).toBe(false);
    expect(net.fuji.sent[0]?.data).toBe(
      encodeFunctionData({
        abi: parseAbi(abi),
        functionName: "transfer",
        args: [ALICE, BigInt(amount)],
      }),
    );

    const rounded = await write({ abi, functionName: "transfer", args: [ALICE, 1e21] });
    expect(rounded.isError).toBe(true);
    expect(rounded.text).toContain("args[1] (uint256 amount) is 1e+21");
    expect(rounded.text).toContain("Pass it as a decimal string instead");

    const badAddress = await write({ abi, functionName: "transfer", args: ["0x1234", 1] });
    expect(badAddress.isError).toBe(true);
    expect(badAddress.text).toContain(
      "Could not encode the arguments for transfer(address to, uint256 amount), so nothing was sent",
    );
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("does not fail a call over a return type the ABI got wrong", async () => {
    // The NFT's approve returns nothing; an agent that assumes ERC-20 writes
    // `returns (bool)`. The node answers "0x", and the call itself is fine.
    net.fuji.callResult = "0x";
    const result = await write({
      abi: ["function approve(address spender, uint256 tokenId) returns (bool)"],
      functionName: "approve",
      args: [ALICE, 1],
    });
    expect(result.isError).toBe(false);
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("picks an overload by its full signature", async () => {
    const abi = [
      "function safeTransferFrom(address from, address to, uint256 tokenId)",
      "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
    ];
    const result = await write({
      abi,
      functionName: "safeTransferFrom(address,address,uint256,bytes)",
      args: [wallet, ALICE, 1, "0x"],
    });
    expect(result.isError).toBe(false);
    expect(net.fuji.sent[0]?.data.slice(0, 10)).toBe("0xb88d4fde");
  });

  it("sends value with a payable call only on a testnet and with the user's own key", async () => {
    const abi = ["function buy() payable", "function mint()"];
    const paid = await write({ abi, functionName: "buy", value: "1000000000000000" });
    expect(paid.isError).toBe(false);
    expect(net.fuji.sent[0]).toMatchObject({ value: 1_000_000_000_000_000n, data: "0xa6f2ae3a" });

    const notPayable = await write({ abi, functionName: "mint", value: "1" });
    expect(notPayable.isError).toBe(true);
    expect(notPayable.text).toBe(
      '"mint" is not payable, so it cannot be sent AVAX. Leave value out.',
    );

    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    const mainnet = await write({
      abi,
      functionName: "buy",
      value: "1",
      chain: "c-chain",
      confirm: true,
    });
    expect(mainnet.isError).toBe(true);
    expect(mainnet.text).toBe(
      "write_contract does not send AVAX on Avalanche C-Chain (mainnet): value is for testnets only.",
    );
    expect(net.cChain.calls).toEqual([]);

    for (const value of ["-1", "1.5", "0x10", "1e18", ""]) {
      const invalid = await write({ abi, functionName: "buy", value });
      expect(invalid.isError, value).toBe(true);
    }
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("refuses when the wallet cannot pay, and never asks the faucet for a wallet of the user's", async () => {
    net.fuji.setBalance(wallet, 0n);
    const result = await write();
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      `Wallet ${wallet} has no AVAX on Avalanche Fuji. Fund it via ${fuji.faucetUrl} before sending.`,
    );
    expect(net.fuji.sent).toEqual([]);
    expect(net.faucet.requests).toEqual([]);
  });

  it("does not return until the node's state has caught up with the transaction", async () => {
    // A block is accepted before it is executed. If the tool answered at the
    // receipt, the next call would be simulated against the state from before
    // this one — and an approve-then-transfer would "revert" for no reason.
    net.fuji.nonceLag = 3;
    expect((await write()).isError).toBe(false);
    const latest = net.fuji
      .callsTo("eth_getTransactionCount")
      .filter(([, tag]) => tag === "latest");
    // Three reads still showed the old state; the fourth showed the new one.
    expect(latest).toHaveLength(4);
    expect(time.sleeps).toEqual([400, 400, 400]);
  });

  it("uses the next nonce for a second call, even while the node still reports the old one", async () => {
    // Longer than the tool waits for: the nonce must not depend on that wait.
    net.fuji.nonceLag = 12;
    expect((await write()).isError).toBe(false);
    expect((await write()).isError).toBe(false);
    expect(net.fuji.sent.map((sent) => sent.nonce)).toEqual([0, 1]);
  });

  it("accepts only a well-formed contract address", async () => {
    const refused = [
      "0x1234",
      "c1",
      `0x${"zz".repeat(20)}`,
      // Mixed case that is not a valid checksum: one character off somewhere.
      "0x52908400098527886E0F7030069857D2E4169ee7",
      "",
    ];
    for (const address of refused) {
      const result = await write({ address });
      expect(result.isError, address).toBe(true);
      expect(result.text).toContain("Invalid arguments for tool write_contract");
    }
    expect(net.fuji.calls).toEqual([]);

    // All lowercase and correctly checksummed are both fine.
    const checksummed = "0x52908400098527886E0F7030069857D2E4169EE7";
    for (const address of [checksummed.toLowerCase(), checksummed]) {
      net.fuji.setCode(address);
      expect((await write({ address })).isError, address).toBe(false);
    }
  });

  it("rejects arguments it does not declare, and inputs beyond its bounds", async () => {
    expect((await write({ gasLimit: 1 })).isError).toBe(true);
    expect((await write({ args: Array.from({ length: 101 }, () => 1) })).isError).toBe(true);
    expect((await write({ abi: Array.from({ length: 5001 }, () => "function f()") })).isError).toBe(
      true,
    );
    expect((await write({ functionName: "" })).isError).toBe(true);
    expect(net.fuji.calls).toEqual([]);
  });

  describe("given the ABI as a file", () => {
    let base: string;
    let cwd: string;

    beforeEach(() => {
      base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-write-")));
      cwd = path.join(base, "work");
      mkdirSync(path.join(cwd, "lib"), { recursive: true });
      vi.spyOn(process, "cwd").mockReturnValue(cwd);
      writeFileSync(
        path.join(cwd, "lib", "nft-artifact.ts"),
        `export const abi = ${JSON.stringify([
          {
            type: "function",
            name: "mint",
            inputs: [],
            outputs: [],
            stateMutability: "nonpayable",
          },
          { type: "error", name: "SoldOut", inputs: [{ name: "max", type: "uint256" }] },
        ])} as const;\n\nexport const bytecode = "0x6080" as Hex;\n`,
      );
    });
    afterEach(() => rmSync(base, { recursive: true, force: true }));

    it("calls the function from the artifact's ABI, and names its errors", async () => {
      const args = { address: CONTRACT, artifactPath: "lib/nft-artifact.ts", functionName: "mint" };
      const result = await mcp.call("write_contract", args);
      expect(result.isError).toBe(false);
      expect(net.fuji.sent[0]).toMatchObject({ to: CONTRACT, data: "0x1249c58b" });

      net.fuji.callFailure = {
        code: 3,
        message: "execution reverted",
        data: encodeErrorResult({
          abi: parseAbi(["error SoldOut(uint256 max)"]),
          errorName: "SoldOut",
          args: [100n],
        }),
      };
      const reverted = await mcp.call("write_contract", args);
      expect(reverted.text).toContain("Reason: custom error SoldOut(100).");
    });

    it("takes the ABI one way or the other, never both and never neither", async () => {
      const both = await mcp.call("write_contract", {
        address: CONTRACT,
        artifactPath: "lib/nft-artifact.ts",
        abi: MINT,
        functionName: "mint",
      });
      expect(both.isError).toBe(true);
      expect(both.text).toBe("write_contract takes the ABI as artifactPath or as abi, not both.");

      const neither = await mcp.call("write_contract", { address: CONTRACT, functionName: "mint" });
      expect(neither.isError).toBe(true);
      expect(neither.text).toContain("write_contract needs the contract's ABI: pass artifactPath");
      expect(net.fuji.calls).toEqual([]);
    });

    it("refuses a file outside the working directory", async () => {
      writeFileSync(path.join(base, "abi.json"), JSON.stringify({ abi: MINT }));
      const result = await mcp.call("write_contract", {
        address: CONTRACT,
        artifactPath: path.join(base, "abi.json"),
        functionName: "mint",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("Refusing to read");
      expect(net.fuji.calls).toEqual([]);
    });
  });
});
