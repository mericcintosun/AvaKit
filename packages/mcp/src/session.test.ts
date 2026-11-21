/**
 * The session test wallet, through the tools: what someone with a clean
 * machine and no key gets when they ask an agent to deploy to Fuji.
 *
 * Every test starts a fresh server (and so a fresh wallet), because the wallet
 * is made once per process and a test should not inherit another one's.
 */

import { fuji } from "@avakit/core";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "./testing/connect.js";
import type { FakeClock, FakeNetwork, FaucetAnswer } from "./testing/network.js";

// Every key generated while a test runs. Nothing hands the session wallet's
// key out, so this is the only way to know what must not appear anywhere.
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

const DEPLOY = { abi: [], bytecode: "0x6080" };
const BUILDER_HUB = "https://build.avax.network/console/primary-network/faucet";

let mcp: Connection;
let net: FakeNetwork;
let time: FakeClock;
let stderr: string[];
let stdout: string[];

beforeEach(async () => {
  generated.length = 0;
  vi.resetModules();
  const network = await import("./testing/network.js");
  net = network.fakeNetwork();
  time = network.fakeClock();
  stderr = [];
  stdout = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.stubEnv("AVAKIT_DEPLOYER_KEY", "");
  vi.stubEnv("AVAKIT_TEST_WALLET", "");
  vi.stubEnv("AVAKIT_ALLOW_MAINNET", "");
  vi.stubEnv("AVAKIT_FAUCET_URL", "");
  vi.stubEnv("AVAKIT_WRITE_ALLOWLIST", "");
  vi.stubEnv("AVAKIT_MAX_VALUE", "");
  mcp = await (await import("./testing/connect.js")).connect();
});
afterEach(async () => {
  await mcp.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const deploy = (args: Record<string, unknown> = {}) =>
  mcp.call("deploy_contract", { ...DEPLOY, ...args });

/** The session wallet's address, as `wallet_status` reports it. */
async function sessionAddress(): Promise<string> {
  const status = await mcp.call("wallet_status");
  return status.json<{ address: string }>().address;
}

describe("on Fuji with no key configured", () => {
  it("deploys and mints with a wallet the server made, funded by the faucet", async () => {
    const status = await mcp.call("wallet_status");
    expect(status.isError).toBe(false);
    const wallet = status.json<{ address: string; note: string }>();
    expect(wallet).toEqual({
      address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      source: "session",
      chain: "fuji",
      balanceWei: "0",
      balanceAvax: "0",
      note: expect.stringContaining("A zero balance is normal before its first transaction"),
    });
    // Looking is free: nothing was asked of the faucet and nothing was signed.
    expect(net.faucet.requests).toEqual([]);
    expect(net.fuji.sent).toEqual([]);

    const deployed = await deploy();
    expect(deployed.isError).toBe(false);
    const contract = deployed.json<{ address: string; note: string }>();
    const created = getAddress(net.fuji.sent[0]?.created ?? "");
    expect(contract).toEqual({
      address: created,
      txHash: net.fuji.sent[0]?.hash,
      explorerUrl: `${fuji.explorerUrl}/address/${created}`,
      signer: { address: wallet.address, source: "session" },
      note:
        "Signed with a temporary Fuji test wallet that lives only until the server stops. " +
        "The AvaKit faucet funded it with 0.02 AVAX for this call.",
    });
    // One drip, for that wallet, on Fuji.
    expect(net.faucet.requests).toEqual([{ address: wallet.address, chainId: 43113 }]);
    // What was signed: a Fuji transaction, carrying no value, from that wallet.
    expect(net.fuji.sent[0]).toMatchObject({
      from: wallet.address,
      chainId: 43113,
      value: 0n,
      to: null,
      data: "0x6080",
      type: "eip1559",
    });

    const minted = await mcp.call("write_contract", {
      address: contract.address,
      abi: ["function mint() returns (uint256)"],
      functionName: "mint",
    });
    expect(minted.isError).toBe(false);
    expect(minted.json()).toEqual({
      txHash: net.fuji.sent[1]?.hash,
      status: "success",
      blockNumber: expect.stringMatching(/^\d+$/),
      explorerUrl: `${fuji.explorerUrl}/tx/${net.fuji.sent[1]?.hash}`,
      signer: { address: wallet.address, source: "session" },
      // It could pay this time, so the faucet is not mentioned — or asked.
      note: "Signed with a temporary Fuji test wallet that lives only until the server stops.",
    });
    expect(net.fuji.sent[1]).toMatchObject({
      from: wallet.address,
      to: contract.address.toLowerCase(),
      data: "0x1249c58b",
      chainId: 43113,
      value: 0n,
      nonce: 1,
    });
    expect(net.faucet.requests).toHaveLength(1);

    // One wallet for the whole session: one key was ever generated.
    expect(generated).toHaveLength(1);
    expect(privateKeyToAccount(generated[0] as `0x${string}`).address).toBe(wallet.address);
    expect(net.cChain.calls).toEqual([]);
    expect(net.strays).toEqual([]);
  });

  it("does not ask the faucet while the wallet can pay", async () => {
    net.fuji.setBalance(await sessionAddress(), 10n ** 17n);
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(result.json<{ note: string }>().note).toBe(
      "Signed with a temporary Fuji test wallet that lives only until the server stops.",
    );
    expect(net.faucet.requests).toEqual([]);
  });

  it("waits for the drip to arrive before it sends", async () => {
    net.faucet.arrivalDelay = 5;
    const result = await deploy();
    expect(result.isError).toBe(false);
    // The balance was read once before asking, then once a second until it was there.
    expect(net.fuji.callsTo("eth_getBalance")).toHaveLength(6);
    expect(time.sleeps.filter((ms) => ms === 1000)).toHaveLength(5);
  });

  it("gives up after about thirty seconds when the drip does not arrive, and sends nothing", async () => {
    net.faucet.arrivalDelay = Number.POSITIVE_INFINITY;
    const started = time.now;
    const result = await deploy();
    expect(result.isError).toBe(true);
    const wallet = await sessionAddress();
    expect(result.text).toContain(
      `The AvaKit faucet accepted the request (its transaction: 0x${"fa".repeat(32)}), but the test ` +
        `AVAX had not reached the session test wallet ${wallet} after 30 seconds.`,
    );
    expect(result.text).toContain("Nothing was sent");
    expect(time.now - started).toBeGreaterThanOrEqual(30_000);
    expect(time.now - started).toBeLessThan(32_000);
    expect(net.fuji.sent).toEqual([]);
    expect(net.faucet.requests).toHaveLength(1);
  });

  it("says so when the drip arrives but does not cover the transaction", async () => {
    // 20,000,000 gas at 1.7 nAVAX is 0.034 AVAX; a drip is 0.02.
    net.fuji.gasEstimate = 20_000_000n;
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("The AvaKit faucet funded the session test wallet");
    expect(result.text).toContain(
      "but its 0.02 AVAX does not cover it: this deployment needs about 0.034 AVAX at the current gas price.",
    );
    expect(result.text).toContain("Nothing was sent");
    expect(net.fuji.sent).toEqual([]);
  });

  it("states the faucet's reason and the two ways forward when the faucet says no", async () => {
    const refusals: [FaucetAnswer, string][] = [
      [
        {
          status: 429,
          body: {
            error: "This address was funded recently. Try again later.",
            code: "address_limited",
          },
          headers: { "retry-after": "86000" },
        },
        "it already funded this wallet in the last 24 hours, and gives one drip per wallet per day; it can be asked again in about 24 hours",
      ],
      [
        { status: 429, body: { code: "ip_limited" }, headers: { "retry-after": "900" } },
        "its hourly limit for your network has been reached; it can be asked again in about 15 minutes",
      ],
      [{ status: 503, body: { code: "faucet_empty" } }, "it is out of test AVAX"],
      [
        { status: 403, body: { code: "turnstile_required" } },
        "it asks for a human verification step that this server cannot complete",
      ],
      [
        { status: 400, body: { code: "unsupported_chain" } },
        "it rejected the request as invalid (HTTP 400)",
      ],
    ];
    const wallet = await sessionAddress();
    for (const [answer, reason] of refusals) {
      net.faucet.requests.length = 0;
      net.faucet.script = [answer];
      const result = await deploy();
      expect(result.isError, reason).toBe(true);
      expect(result.text).toBe(
        `The session test wallet ${wallet} has 0 AVAX on Avalanche Fuji and this deployment needs ` +
          `about 0.000204 AVAX. The AvaKit faucet did not fund it: ${reason}. Nothing was sent. ` +
          "Two ways forward: set AVAKIT_DEPLOYER_KEY to your own funded Fuji key, or get test AVAX at " +
          `${BUILDER_HUB} (needs a free Builder Hub sign-in) for ${wallet} and call this tool again ` +
          "while the server is still running.",
      );
      // The page named is the one in the chain's definition.
      expect(BUILDER_HUB).toBe(fuji.faucetUrl);
      // Asked once: a refusal is an answer, not something to retry.
      expect(net.faucet.requests, reason).toHaveLength(1);
    }
    expect(net.fuji.sent).toEqual([]);
  });

  it("asks the faucet again after no answer or a failure on its side, three times at most", async () => {
    // The pause between attempts is random from zero up; zero keeps the test quick.
    vi.spyOn(Math, "random").mockReturnValue(0);
    net.faucet.script = ["network", { status: 502, body: { code: "drip_failed" } }];
    const third = await deploy();
    expect(third.isError).toBe(false);
    expect(net.faucet.requests).toHaveLength(3);
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("asks a busy faucet again, and says so in plain words when it stays busy", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const busy: FaucetAnswer = { status: 503, body: { code: "faucet_busy" } };
    // Busy once, then served.
    net.faucet.script = [busy];
    expect((await deploy()).isError).toBe(false);
    expect(net.faucet.requests).toHaveLength(2);

    // Busy three times: that is the answer.
    const wallet = await sessionAddress();
    net.fuji.setBalance(wallet, 0n);
    net.faucet.requests.length = 0;
    net.faucet.script = [busy, busy, busy];
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "The AvaKit faucet did not fund it: it is busy right now; calling this tool again in a few seconds may work. Nothing was sent.",
    );
    expect(net.faucet.requests).toHaveLength(3);
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("stops after three failed attempts and says what the last one was", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    net.faucet.script = ["timeout", { status: 500 }, "network", "fund"];
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "The AvaKit faucet did not fund it: it did not answer properly in 3 attempts (the last one: network error ECONNREFUSED).",
    );
    expect(result.text).toContain("AVAKIT_DEPLOYER_KEY");
    expect(result.text).toContain(BUILDER_HUB);
    expect(net.faucet.requests).toHaveLength(3);
    expect(net.fuji.sent).toEqual([]);
  });

  it("looks for the drip before giving up when an answer was lost on the way", async () => {
    // The faucet served the first request; its answer never arrived. Asked
    // again, it says "funded recently". Both are true, and the money is there.
    vi.spyOn(Math, "random").mockReturnValue(0);
    net.faucet.script = [
      "fund-then-drop",
      { status: 429, body: { code: "address_limited" }, headers: { "retry-after": "86399" } },
    ];
    net.faucet.arrivalDelay = 3;
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(net.faucet.requests).toHaveLength(2);
    expect(net.fuji.sent).toHaveLength(1);
  });

  it("asks the faucet the server's environment names", async () => {
    net.faucet.url = "http://127.0.0.1:8787/fund";
    vi.stubEnv("AVAKIT_FAUCET_URL", "http://127.0.0.1:8787/fund");
    expect((await deploy()).isError).toBe(false);
    expect(net.faucet.requests).toHaveLength(1);
    expect(net.strays).toEqual([]);

    vi.stubEnv("AVAKIT_FAUCET_URL", "not a url");
    net.fuji.setBalance(await sessionAddress(), 0n);
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "The AvaKit faucet did not fund it: AVAKIT_FAUCET_URL is not an http(s) URL.",
    );
  });

  it("refuses to send value, before anything is asked of the chain", async () => {
    const result = await mcp.call("write_contract", {
      address: "0x00000000000000000000000000000000000000c1",
      abi: ["function buy() payable"],
      functionName: "buy",
      value: "1000000000000000",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "The session test wallet never sends AVAX with a call: it pays for gas on Fuji and nothing " +
        "else. To call a payable function with value, set AVAKIT_DEPLOYER_KEY to your own funded Fuji key.",
    );
    expect(net.fuji.calls).toEqual([]);
    expect(net.faucet.requests).toEqual([]);
  });
});

describe("where the session wallet is not used", () => {
  it("is never used on mainnet, even with both mainnet gates open", async () => {
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    for (const call of [
      () => deploy({ chain: "c-chain", confirm: true }),
      () =>
        mcp.call("write_contract", {
          address: "0x00000000000000000000000000000000000000c1",
          abi: ["mint()"],
          functionName: "mint",
          chain: "c-chain",
          confirm: true,
        }),
    ]) {
      const result = await call();
      expect(result.isError).toBe(true);
      expect(result.text).toBe(
        "No deployer key found. On Avalanche C-Chain this server signs only with your own key: set " +
          "AVAKIT_DEPLOYER_KEY in the server environment. The session test wallet works on the Fuji testnet only.",
      );
    }
    const status = await mcp.call("wallet_status", { chain: "c-chain" });
    expect(status.json()).toEqual({
      address: null,
      source: "none",
      chain: "c-chain",
      balanceWei: null,
      balanceAvax: null,
      note: expect.stringContaining("The session test wallet works on the Fuji testnet only."),
    });
    // No wallet was made for it, and neither chain nor the faucet heard a thing.
    expect(generated).toEqual([]);
    expect(net.cChain.calls).toEqual([]);
    expect(net.fuji.calls).toEqual([]);
    expect(net.faucet.requests).toEqual([]);
  });

  it("is turned off by AVAKIT_TEST_WALLET=0, and the tools ask for a key as they used to", async () => {
    vi.stubEnv("AVAKIT_TEST_WALLET", "0");
    const asksForKey =
      "No deployer key found. Set AVAKIT_DEPLOYER_KEY to a 0x private key (use a throwaway testnet " +
      "key — never a key holding real funds). The session test wallet is turned off (AVAKIT_TEST_WALLET=0).";
    const deployed = await deploy();
    expect(deployed.isError).toBe(true);
    expect(deployed.text).toBe(asksForKey);
    const written = await mcp.call("write_contract", {
      address: "0x00000000000000000000000000000000000000c1",
      abi: ["mint()"],
      functionName: "mint",
    });
    expect(written.isError).toBe(true);
    expect(written.text).toBe(asksForKey);
    expect((await mcp.call("wallet_status")).json()).toEqual({
      address: null,
      source: "none",
      chain: "fuji",
      balanceWei: null,
      balanceAvax: null,
      note: asksForKey,
    });
    expect(generated).toEqual([]);
    expect(net.fuji.calls).toEqual([]);
    expect(net.faucet.requests).toEqual([]);
  });

  it("gives way to AVAKIT_DEPLOYER_KEY as soon as one is set", async () => {
    const session = await sessionAddress();
    const { generatePrivateKey } = await import("viem/accounts");
    const key = generatePrivateKey();
    const own = privateKeyToAccount(key).address;
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", key);
    net.fuji.setBalance(own, 10n ** 18n);

    const status = await mcp.call("wallet_status");
    // The user's own wallet: no note about a temporary one.
    expect(status.json()).toEqual({
      address: own,
      source: "env",
      chain: "fuji",
      balanceWei: "1000000000000000000",
      balanceAvax: "1",
    });
    const result = await deploy();
    expect(result.json()).toMatchObject({ signer: { address: own, source: "env" } });
    expect(result.json()).not.toHaveProperty("note");
    expect(net.fuji.sent[0]?.from).toBe(own);
    expect(own).not.toBe(session);
    expect(net.faucet.requests).toEqual([]);
  });
});

describe("the session wallet's key", () => {
  it("appears in no tool result, no error, no request and no log line", async () => {
    const wallet = await sessionAddress();
    const calls: [string, Record<string, unknown>][] = [
      ["wallet_status", {}],
      ["wallet_status", { chain: "c-chain" }],
      ["deploy_contract", DEPLOY],
      ["deploy_contract", { ...DEPLOY, chain: "c-chain", confirm: true }],
      ["deploy_contract", { artifactPath: "../outside.json" }],
      ["deploy_contract", { abi: ["constructor(uint256 cap)"], bytecode: "0x6080" }],
      ["write_contract", { address: wallet, abi: ["mint()"], functionName: "mint" }],
      ["write_contract", { address: wallet, abi: ["mint()"], functionName: "burn" }],
      [
        "write_contract",
        { address: wallet, abi: ["buy() payable"], functionName: "buy", value: "1" },
      ],
      ["read_chain", { action: "balance", address: wallet }],
      ["get_context", {}],
    ];
    const results: string[] = [];
    for (const [name, args] of calls) results.push((await mcp.call(name, args)).text);

    // Then the ways it can fail: the faucet refusing, the node rejecting, the
    // RPC answering as another chain, a transaction that never confirms.
    net.fuji.setBalance(wallet, 0n);
    net.faucet.script = [{ status: 429, body: { code: "address_limited" } }];
    results.push((await deploy()).text);
    net.fuji.setBalance(wallet, 10n ** 18n);
    net.fuji.estimateFailure = { code: 3, message: "execution reverted: nope" };
    results.push((await deploy()).text);
    net.fuji.estimateFailure = undefined;
    net.fuji.override("eth_sendRawTransaction", () => {
      throw { code: -32000, message: "transaction underpriced" };
    });
    results.push((await deploy()).text);
    net.fuji.chainId = 43114;
    results.push((await deploy()).text);

    expect(generated).toHaveLength(1);
    const key = (generated[0] as string).slice(2).toLowerCase();
    const said = [
      ...results,
      ...stderr,
      ...stdout,
      // Everything that went out over the network: every RPC call's parameters
      // (raw signed transactions among them) and every faucet request.
      JSON.stringify(net.fuji.calls),
      JSON.stringify(net.cChain.calls),
      JSON.stringify(net.faucet.requests),
      JSON.stringify(net.faucet.inits.map((init) => [init.headers, init.body])),
      JSON.stringify(net.strays),
    ]
      .join("\n")
      .toLowerCase();
    // A real run: results, errors, a signed transaction, log lines.
    expect(results).toHaveLength(calls.length + 4);
    expect(net.fuji.sent.length).toBeGreaterThanOrEqual(1);
    expect(stderr.join("")).toContain("created a session test wallet");
    expect(said).toContain(wallet.toLowerCase());
    expect(said).not.toContain(key);
    // Not in halves either.
    expect(said).not.toContain(key.slice(0, 32));
    expect(said).not.toContain(key.slice(32));
  });

  it("is never written to stdout, where it would also break the protocol", async () => {
    await deploy();
    await mcp.call("write_contract", {
      address: net.fuji.sent[0]?.created,
      abi: ["mint()"],
      functionName: "mint",
    });
    net.faucet.script = [{ status: 503, body: { code: "faucet_empty" } }];
    net.fuji.setBalance(await sessionAddress(), 0n);
    await deploy();
    // The tools ran over an in-memory transport, so anything on the real
    // stdout would have been written by the tools themselves.
    expect(stdout).toEqual([]);
    // What goes to stderr is prefixed, one line each, and about addresses.
    expect(stderr.length).toBeGreaterThan(2);
    for (const line of stderr) {
      expect(line).toMatch(/^avakit-mcp: .*\n$/);
      expect(line.trimEnd()).not.toContain("\n");
    }
  });
});
