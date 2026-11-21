import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EWOQ_ADDRESS, isLocalRpcUrl, rpcHost, sendWithDevnetKey } from "./devkey.js";
import { InputError } from "./errors.js";
import { DEFAULT_CHAIN_ID, type FakeRpc, startFakeRpc } from "./testing/sandbox.js";

// The EWOQ key, as it must never appear in a message.
const EWOQ_KEY_HEX = "56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027";

describe("isLocalRpcUrl", () => {
  it("accepts an http(s) URL on this machine, however the loopback address is spelled", () => {
    for (const url of [
      "http://127.0.0.1:9650/ext/bc/2Fsb5ft/rpc",
      "http://localhost:9650/ext/bc/C/rpc",
      "https://127.0.0.1/rpc",
      "http://[::1]:9650/rpc",
      "http://127.0.0.2:9650/rpc",
      // The URL parser normalises these to 127.0.0.1.
      "http://127.1:9650/rpc",
      "http://0x7f.0.0.1/rpc",
      "http://2130706433/rpc",
    ]) {
      expect(isLocalRpcUrl(url), url).toBe(true);
    }
  });

  it("refuses anything that is not on this machine, or not http(s)", () => {
    for (const url of [
      "https://api.avax-test.network/ext/bc/C/rpc",
      "https://api.avax.network/ext/bc/C/rpc",
      "http://10.0.0.5:9650/rpc",
      "http://192.168.1.20:9650/rpc",
      "http://203.0.113.7:9650/rpc",
      // Names that merely start with a loopback spelling.
      "http://127.0.0.1.attacker.example/rpc",
      "http://localhost.attacker.example/rpc",
      // "this host" on some systems, but never what avalanche-cli records.
      "http://0.0.0.0:9650/rpc",
      "http://[::ffff:127.0.0.1]:9650/rpc",
      "ws://127.0.0.1:9650/ext/bc/C/ws",
      "file:///etc/passwd",
      "127.0.0.1:9650",
      "not a url",
      "",
    ]) {
      expect(isLocalRpcUrl(url), url).toBe(false);
    }
  });
});

describe("rpcHost", () => {
  it("names where a URL points, and never throws", () => {
    expect(rpcHost("http://127.0.0.1:9650/ext/bc/x/rpc")).toBe("127.0.0.1:9650");
    expect(rpcHost("nonsense")).toBe("not a URL");
  });
});

describe("the EWOQ devnet key", () => {
  it("is the well-known public key, and appears in Studio's source in one place only", () => {
    expect(EWOQ_ADDRESS).toBe("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC");
    const source = readFileSync(fileURLToPath(new URL("./devkey.ts", import.meta.url)), "utf8");
    expect(source.split(EWOQ_KEY_HEX)).toHaveLength(2);
    // No other module of the server carries it.
    for (const file of ["icm.ts", "devnet.ts", "mcp.ts", "server.ts", "steps.ts", "fuji.ts"]) {
      const text = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
      expect(text, file).not.toContain(EWOQ_KEY_HEX);
    }
  });
});

describe("sendWithDevnetKey", () => {
  let rpc: FakeRpc;
  beforeEach(async () => {
    rpc = await startFakeRpc();
  });
  afterEach(async () => {
    await rpc.close();
  });

  const target = (rpcUrl: string, evmChainId: number | null = DEFAULT_CHAIN_ID) => ({
    name: "chain1",
    rpcUrl,
    evmChainId,
  });
  const CALL = { to: "0x52C84043CD9c865236f11d9Fc9F56aa003c1f922", data: "0x1234" } as const;

  it("signs with EWOQ in this process and waits for the receipt", async () => {
    rpc.configure({ deploy: { chain1: "0x52C84043CD9c865236f11d9Fc9F56aa003c1f922" } });
    const deployed = await sendWithDevnetKey(target(rpc.url("chain1")), { data: "0x6080" });
    expect(deployed.contractAddress?.toLowerCase()).toBe(
      "0x52c84043cd9c865236f11d9fc9f56aa003c1f922",
    );
    const called = await sendWithDevnetKey(target(rpc.url("chain1")), CALL);
    expect(called.contractAddress).toBeNull();

    const txs = rpc.transactions();
    expect(txs.map((tx) => [tx.from, tx.chainId, tx.to])).toEqual([
      [EWOQ_ADDRESS, DEFAULT_CHAIN_ID, null],
      [EWOQ_ADDRESS, DEFAULT_CHAIN_ID, CALL.to.toLowerCase()],
    ]);
    expect(called.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("refuses an RPC URL that is not on this machine before asking anything", async () => {
    for (const rpcUrl of [
      "https://api.avax-test.network/ext/bc/C/rpc",
      "http://10.0.0.5:9650/rpc",
    ]) {
      const failure = await sendWithDevnetKey(target(rpcUrl), CALL).catch((e: unknown) => e);
      expect(failure, rpcUrl).toBeInstanceOf(InputError);
      expect((failure as Error).message).toBe(
        `chain1's RPC URL (${new URL(rpcUrl).host}) is not on this machine: Studio signs only for local devnets, with the public EWOQ devnet key`,
      );
    }
    expect(rpc.seen).toEqual([]);
  });

  it("refuses an RPC that answers for another chain than avalanche-cli created", async () => {
    rpc.setChainId("chain1", 43114);
    const failure = await sendWithDevnetKey(target(rpc.url("chain1")), CALL).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(InputError);
    expect((failure as Error).message).toBe(
      "chain1's RPC answers for chain ID 43114, not the chain ID 1001 avalanche-cli created it with: Studio does not sign there",
    );
    // It asked which chain, and sent nothing.
    expect(rpc.seen).toEqual(["chain1:eth_chainId"]);
    expect(rpc.transactions()).toEqual([]);
  });

  it("signs for the chain the RPC names when avalanche-cli's genesis does not say", async () => {
    rpc.setChainId("chain1", 4242);
    await sendWithDevnetKey(target(rpc.url("chain1"), null), CALL);
    expect(rpc.transactions()[0]?.chainId).toBe(4242);
  });

  it("fails on a reverted transaction, and passes the node's words on without the key", async () => {
    rpc.configure({ receiptStatus: "0x0" });
    await expect(sendWithDevnetKey(target(rpc.url("chain1")), CALL)).rejects.toThrow(
      "the transaction was mined but reverted",
    );

    rpc.configure({ deployError: "insufficient funds for gas * price + value" });
    const failure = await sendWithDevnetKey(target(rpc.url("chain1")), { data: "0x6080" }).catch(
      (e: Error) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/insufficient funds/);
    expect((failure as Error).message.length).toBeLessThanOrEqual(600);
    expect((failure as Error).message.toLowerCase()).not.toContain(EWOQ_KEY_HEX);
  });

  it("never follows an RPC that redirects elsewhere", async () => {
    // On this machine, but answering every request with a redirect to the fake chain.
    const redirector = createServer((_req, res) => {
      res.writeHead(307, { location: rpc.url("chain1") });
      res.end();
    });
    const port = await new Promise<number>((resolve) => {
      redirector.listen(0, "127.0.0.1", () => {
        const addr = redirector.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    try {
      const failure = await sendWithDevnetKey(
        target(`http://127.0.0.1:${port}/chain1/rpc`),
        CALL,
      ).catch((e: Error) => e);
      expect(failure).toBeInstanceOf(Error);
      // The redirect target was never asked anything.
      expect(rpc.seen).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => redirector.close(() => resolve()));
    }
  });

  it("says so when the RPC does not answer", async () => {
    const failure = await sendWithDevnetKey(target("http://127.0.0.1:9/rpc"), CALL).catch(
      (e: Error) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InputError);
    expect((failure as Error).message).toMatch(/HTTP request failed/);
  });
});
