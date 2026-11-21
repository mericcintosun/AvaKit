import { decodeAbiParameters, decodeFunctionData, parseAbi } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EWOQ_ADDRESS } from "./devkey.js";
import { InputError } from "./errors.js";
import {
  deployMessengers,
  getIcmState,
  MAX_MESSAGE_BYTES,
  messageProblem,
  sendIcmMessage,
} from "./icm.js";
import { SEND_MESSAGE_SIG } from "./messenger-artifact.js";
import {
  blockchainId,
  createSandbox,
  DEFAULT_CHAIN_ID,
  ewoqKeyHex,
  type FakeRpc,
  type Sandbox,
  SEND_MESSAGE_SELECTOR,
  SET_TRUSTED_REMOTE_SELECTOR,
  startFakeRpc,
} from "./testing/sandbox.js";

// The address the dev key deploys to at nonce 0 — the SAME on every fresh L1.
const SHARED = "0x52C84043CD9c865236f11d9Fc9F56aa003c1f922";
const OTHER = "0x17aB05351fC94a1a67Bf3f56DdbB941aE6c63E25";
const STALE = "0x000000000000000000000000000000000000dEaD";
// A messenger an earlier Studio deployed: it has code, but no message-length cap.
const OLD = "0x5DB9A7629912EBF95876228C24A848de0bfB43A9";

// The EWOQ key, as it must never appear anywhere it could be read (read from devkey.ts).
const EWOQ_KEY_HEX = ewoqKeyHex();

const id1 = blockchainId(1);
const id2 = blockchainId(2);
const id3 = blockchainId(3);

let sandbox: Sandbox;
let rpc: FakeRpc;

beforeEach(async () => {
  sandbox = createSandbox();
  rpc = await startFakeRpc();
});
afterEach(async () => {
  await rpc.close();
  sandbox.dispose();
});

/** Two running, ICM-ready local L1s — what "Spin up ICM devnet" leaves behind. */
function twoChains(): void {
  sandbox.addL1("chain1", { local: { rpcUrl: rpc.url("chain1"), blockchainId: id1.cb58 } });
  sandbox.addL1("chain2", { local: { rpcUrl: rpc.url("chain2"), blockchainId: id2.cb58 } });
}

/** Both chains with a live, recorded messenger at `address`. */
function deployed(address = SHARED): void {
  twoChains();
  rpc.setCode("chain1", address);
  rpc.setCode("chain2", address);
  sandbox.writeIcmState({ chain1: address, chain2: address });
}

/** Every deployment the chains received. */
const creates = () => rpc.transactions().filter((tx) => tx.to === null);

/** Every `setTrustedRemote` the chains received: who now trusts whom. */
const links = () =>
  rpc
    .transactions()
    .filter((tx) => tx.data.startsWith(SET_TRUSTED_REMOTE_SELECTOR))
    .map((tx) => {
      const [remoteChain, remote] = decodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }],
        `0x${tx.data.slice(10)}`,
      );
      return { chain: tx.chain, messenger: tx.to, remoteChain, remote };
    });

const SEND_MESSAGE_ABI = parseAbi([`function ${SEND_MESSAGE_SIG}`]);
/** Every `sendMessage` transaction the chains received, decoded from its calldata. */
const sentMessages = () =>
  rpc
    .transactions()
    .filter((tx) => tx.data.startsWith(SEND_MESSAGE_SELECTOR))
    .map((tx) => {
      const { args } = decodeFunctionData({ abi: SEND_MESSAGE_ABI, data: tx.data });
      return {
        chain: tx.chain,
        from: tx.from,
        messenger: tx.to,
        to: args[0],
        remote: args[1],
        text: args[2],
      };
    });

describe("getIcmState", () => {
  it("lists only the running, Teleporter-ready L1s of the local network", async () => {
    twoChains();
    // Studio's own Fuji wizard leaves a directory like this: never running locally.
    sandbox.addL1("myfujil1", {
      fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: id3.cb58 },
    });
    // Deployed locally once; the network it lived on is gone.
    sandbox.addL1("stopped", {
      local: { rpcUrl: "http://127.0.0.1:9/stopped/rpc", blockchainId: blockchainId(4).cb58 },
    });
    // Configured but never deployed anywhere.
    sandbox.addL1("configured");
    // Running, but created without Interchain Messaging.
    sandbox.addL1("noicm", {
      local: { rpcUrl: rpc.url("noicm"), blockchainId: blockchainId(5).cb58 },
      teleporterReady: false,
    });
    // Running, but its recorded blockchain ID is corrupt.
    sandbox.addL1("badid", { local: { rpcUrl: rpc.url("badid"), blockchainId: "not-cb58" } });

    const state = await getIcmState();
    expect(state.chains.map((c) => c.name)).toEqual(["chain1", "chain2"]);
    // Two L1s to work with — but no messenger yet, so nothing can be sent.
    expect(state.hasPeers).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.maxMessageBytes).toBe(MAX_MESSAGE_BYTES);
    expect(state.chains[0]).toEqual({
      name: "chain1",
      evmChainId: 1001,
      rpcUrl: rpc.url("chain1"),
      blockchainIdHex: id1.hex,
      running: true,
      messenger: null,
      lastMessage: null,
      messagesReceived: null,
    });
  });

  it("leaves out an L1 whose local RPC URL is not on this machine, without calling it", async () => {
    twoChains();
    // A hand-edited config: its "local" RPC is somewhere else (a documentation address).
    sandbox.addL1("elsewhere", {
      local: { rpcUrl: "http://203.0.113.7:9650/ext/bc/x/rpc", blockchainId: id3.cb58 },
    });
    sandbox.writeIcmState({ elsewhere: SHARED });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.name)).toEqual(["chain1", "chain2"]);
  });

  it("is not ready with fewer than two eligible L1s", async () => {
    sandbox.addL1("chain1", { local: { rpcUrl: rpc.url("chain1"), blockchainId: id1.cb58 } });
    sandbox.addL1("myfujil1", { fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: id3.cb58 } });
    const state = await getIcmState();
    expect(state.ready).toBe(false);
    expect(state.hasPeers).toBe(false);
    expect(state.chains.map((c) => c.name)).toEqual(["chain1"]);
  });

  it("is not ready while no messenger is deployed, however many L1s are running", async () => {
    // What the release gate ran: three running chains, no icm-state.json.
    // `ready` was true, and the very next send answered "deploy the messengers first".
    twoChains();
    sandbox.addL1("chain3", { local: { rpcUrl: rpc.url("chain3"), blockchainId: id3.cb58 } });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([null, null, null]);
    expect(state.hasPeers).toBe(true);
    expect(state.ready).toBe(false);
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "deploy the messengers first",
    );
  });

  it("is ready once two messengers are deployed and linked to each other", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });
    expect((await getIcmState()).ready).toBe(false);

    expect((await deployMessengers()).ready).toBe(true);
    expect((await getIcmState()).ready).toBe(true);

    // A third L1 without a messenger changes nothing for the two that have one.
    sandbox.addL1("chain3", { local: { rpcUrl: rpc.url("chain3"), blockchainId: id3.cb58 } });
    const three = await getIcmState();
    expect(three.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED, null]);
    expect(three.ready).toBe(true);
  });

  it("is not ready while the messengers are not linked in both directions", async () => {
    // Recorded and live, but neither accepts the other's messages yet.
    deployed();
    expect((await getIcmState()).ready).toBe(false);

    // A send links the one direction it needs (chain2 accepts chain1) …
    await sendIcmMessage("chain1", "chain2", "gm");
    expect((await getIcmState()).ready).toBe(false);
    // … and one the other way completes the pair.
    await sendIcmMessage("chain2", "chain1", "gm back");
    expect((await getIcmState()).ready).toBe(true);
  });

  it("is not ready when a link cannot be read", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });
    expect((await deployMessengers()).ready).toBe(true);

    rpc.configure({ trustedRemoteError: "execution reverted" });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED]);
    expect(state.ready).toBe(false);
  });

  it("reads the last message of a live messenger", async () => {
    deployed();
    const state = await getIcmState();
    expect(state.chains.map((c) => [c.messenger, c.lastMessage, c.messagesReceived])).toEqual([
      [SHARED, "hello", 3],
      [SHARED, "hello", 3],
    ]);
  });

  it("does not trust a recorded messenger that no longer has code on the chain", async () => {
    // `avalanche network clean` + re-deploy: same chain names, none of the contracts.
    twoChains();
    sandbox.writeIcmState({ chain1: STALE, chain2: STALE });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([null, null]);
    // Nothing was asked of a contract that is not there.
    expect(rpc.reads()).toEqual([]);
  });

  it("keeps a recorded messenger when the RPC cannot say whether it has code", async () => {
    twoChains();
    rpc.breakCode("chain1");
    rpc.setCode("chain2", SHARED);
    sandbox.writeIcmState({ chain1: SHARED, chain2: SHARED });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED]);
  });

  it("does not trust a recorded messenger from before the message-length cap", async () => {
    // A devnet that outlived a Studio upgrade: the old messenger is still
    // deployed, but it has no MAX_MESSAGE_LENGTH — the call reverts.
    twoChains();
    rpc.setOutdated("chain1", OLD);
    rpc.setCode("chain2", SHARED);
    sandbox.writeIcmState({ chain1: OLD, chain2: SHARED });
    const state = await getIcmState();
    expect(state.chains.map((c) => [c.name, c.messenger, c.lastMessage])).toEqual([
      ["chain1", null, null],
      ["chain2", SHARED, "hello"],
    ]);
    // Nothing but the cap was asked of the old contract.
    expect(rpc.reads().filter((r) => r.startsWith("chain1:"))).toEqual([
      "chain1:MAX_MESSAGE_LENGTH",
    ]);
  });

  it("recognises a revert under either error code a node reports it with", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: OLD, chain2: OLD });
    for (const error of [
      // geth-family nodes (an L1's own) use -32000 for a revert without data …
      { code: -32000, message: "execution reverted" },
      // … and 3 for one with data, as anvil does for every revert.
      { code: 3, message: "execution reverted" },
      { code: 3, message: "execution reverted: no such function" },
    ]) {
      rpc.setOutdated("chain1", OLD, error);
      rpc.setOutdated("chain2", OLD, error);
      const state = await getIcmState();
      expect(
        state.chains.map((c) => c.messenger),
        error.message,
      ).toEqual([null, null]);
    }
  });

  it("keeps a recorded messenger when the RPC cannot say whether it has the cap", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    // Not a revert: the node is busy. Unknown is never treated as outdated.
    rpc.breakCall("chain1");
    sandbox.writeIcmState({ chain1: SHARED, chain2: SHARED });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED]);
    expect(rpc.seen).toContain("chain1:eth_call");
  });

  it("returns a received message exactly as it was sent", async () => {
    // Quotes, backslashes, control and multi-byte characters: all decoded as they are.
    const text = 'say "hi" \\ back\\slash \ttab — 山 🔺 ​';
    deployed();
    rpc.configure({ lastMessage: text });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.lastMessage)).toEqual([text, text]);
  });

  it("ignores state entries that are not addresses", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: "--rpc-url", chain2: 42 });
    expect((await getIcmState()).chains.map((c) => c.messenger)).toEqual([null, null]);
    sandbox.writeIcmState(["not", "an", "object"] as never);
    expect((await getIcmState()).chains.map((c) => c.messenger)).toEqual([null, null]);
    expect(rpc.reads()).toEqual([]);
  });
});

describe("deployMessengers", () => {
  it("links two chains whose messengers have the SAME address", async () => {
    // The default on a fresh devnet: same key, same nonce, so the same address.
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });

    const state = await deployMessengers();

    expect(creates().map((tx) => tx.chain)).toEqual(["chain1", "chain2"]);
    // Each side registers the other chain's messenger as its trusted remote.
    expect(links()).toEqual([
      { chain: "chain1", messenger: SHARED.toLowerCase(), remoteChain: id2.hex, remote: SHARED },
      { chain: "chain2", messenger: SHARED.toLowerCase(), remoteChain: id1.hex, remote: SHARED },
    ]);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED, chain2: SHARED });
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED]);
  });

  it("is idempotent: a second run deploys and links nothing", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });
    await deployMessengers();
    const journal = rpc.journal();
    expect(journal).toEqual(["create chain1", "create chain2", "link chain1", "link chain2"]);

    await deployMessengers();
    expect(rpc.journal()).toEqual(journal);
  });

  it("redeploys and relinks when the recorded messengers are gone", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: STALE, chain2: STALE });
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", OTHER);
    rpc.configure({ deploy: { chain1: SHARED, chain2: OTHER } });

    const state = await deployMessengers();

    expect(rpc.journal()).toEqual(["create chain1", "create chain2", "link chain1", "link chain2"]);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED, chain2: OTHER });
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, OTHER]);
    expect(links()).toEqual([
      { chain: "chain1", messenger: SHARED.toLowerCase(), remoteChain: id2.hex, remote: OTHER },
      { chain: "chain2", messenger: OTHER.toLowerCase(), remoteChain: id1.hex, remote: SHARED },
    ]);
  });

  it("deploys only where a live messenger is missing, and links every pair of three chains", async () => {
    twoChains();
    sandbox.addL1("chain3", { local: { rpcUrl: rpc.url("chain3"), blockchainId: id3.cb58 } });
    // chain1 already has a live one.
    rpc.setCode("chain1", SHARED);
    sandbox.writeIcmState({ chain1: SHARED });
    rpc.setCode("chain2", SHARED);
    rpc.setCode("chain3", SHARED);
    rpc.configure({ deploy: { chain2: SHARED, chain3: SHARED } });

    await deployMessengers();

    expect(rpc.journal().filter((j) => j.startsWith("create"))).toEqual([
      "create chain2",
      "create chain3",
    ]);
    // 3 chains, each trusting the 2 others.
    expect(links().map((l) => `${l.chain} trusts ${l.remoteChain}`)).toEqual([
      `chain1 trusts ${id2.hex}`,
      `chain1 trusts ${id3.hex}`,
      `chain2 trusts ${id1.hex}`,
      `chain2 trusts ${id3.hex}`,
      `chain3 trusts ${id1.hex}`,
      `chain3 trusts ${id2.hex}`,
    ]);
  });

  it("leaves non-running L1s alone", async () => {
    twoChains();
    sandbox.addL1("myfujil1", { fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: id3.cb58 } });
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });
    const state = await deployMessengers();
    expect(creates()).toHaveLength(2);
    expect(state.chains.every((c) => c.messenger)).toBe(true);
    expect(Object.keys(sandbox.readIcmState())).toEqual(["chain1", "chain2"]);
  });

  it("replaces a messenger from before the message-length cap and relinks the chains", async () => {
    // Both chains were set up by an earlier Studio: old messengers, linked to each other.
    twoChains();
    rpc.setCode("chain1", OLD);
    rpc.setCode("chain2", OLD);
    sandbox.writeIcmState({ chain1: OLD, chain2: OLD });
    await deployMessengers();
    expect(rpc.journal()).toEqual(["link chain1", "link chain2"]);

    // Seen for what they are — no MAX_MESSAGE_LENGTH — they count as missing …
    rpc.setOutdated("chain1", OLD);
    rpc.setOutdated("chain2", OLD);
    expect((await getIcmState()).chains.map((c) => c.messenger)).toEqual([null, null]);

    // … and the next deploy puts current ones in their place.
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", OTHER);
    rpc.configure({ deploy: { chain1: SHARED, chain2: OTHER } });
    const state = await deployMessengers();

    expect(rpc.journal().slice(2)).toEqual([
      "create chain1",
      "create chain2",
      "link chain1",
      "link chain2",
    ]);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED, chain2: OTHER });
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, OTHER]);
    // Each new messenger trusts the other NEW one, not the one it replaced.
    expect(links().slice(2)).toEqual([
      { chain: "chain1", messenger: SHARED.toLowerCase(), remoteChain: id2.hex, remote: OTHER },
      { chain: "chain2", messenger: OTHER.toLowerCase(), remoteChain: id1.hex, remote: SHARED },
    ]);
  });

  it("replaces only the outdated messenger and points the current one at its successor", async () => {
    twoChains();
    rpc.setCode("chain1", OLD);
    rpc.setCode("chain2", SHARED);
    sandbox.writeIcmState({ chain1: OLD, chain2: SHARED });
    await deployMessengers(); // chain2's messenger now trusts OLD on chain1

    rpc.setOutdated("chain1", OLD);
    rpc.setCode("chain1", OTHER);
    rpc.configure({ deploy: { chain1: OTHER } });
    await deployMessengers();

    expect(rpc.journal().slice(2)).toEqual(["create chain1", "link chain1", "link chain2"]);
    expect(sandbox.readIcmState()).toEqual({ chain1: OTHER, chain2: SHARED });
    expect(links().slice(2)).toEqual([
      { chain: "chain1", messenger: OTHER.toLowerCase(), remoteChain: id2.hex, remote: SHARED },
      { chain: "chain2", messenger: SHARED.toLowerCase(), remoteChain: id1.hex, remote: OTHER },
    ]);
  });

  it("refuses to record a messenger it would not call usable itself", async () => {
    // The bytecode Studio ships and its own "is this messenger current?" check
    // must agree. If a deploy produces a contract without the cap, say so —
    // recording it would only lead to "no messenger here" on the next look.
    twoChains();
    rpc.setOutdated("chain1", OLD);
    rpc.configure({ deploy: { chain1: OLD, chain2: OLD } });
    await expect(deployMessengers()).rejects.toThrow(
      "the messenger deployed on chain1 has no message-length cap: this build of Studio ships outdated messenger bytecode",
    );
    expect(rpc.journal()).toEqual(["create chain1"]);
    expect(sandbox.readIcmState()).toEqual({});
  });

  it("fails when a transaction is mined but reverted, and records nothing", async () => {
    twoChains();
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED }, receiptStatus: "0x0" });
    await expect(deployMessengers()).rejects.toThrow("the transaction was mined but reverted");
    expect(sandbox.readIcmState()).toEqual({});
  });

  it("fails when a link cannot be read, instead of assuming it is there", async () => {
    deployed();
    rpc.configure({ trustedRemoteError: "header not found" });
    await expect(deployMessengers()).rejects.toThrow("header not found");
    expect(rpc.journal()).toEqual([]);
  });

  it("records each deployed address at once, so a later failure cannot lose it", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    // chain2's deploy is mined without a contract address.
    rpc.configure({ deploy: { chain1: SHARED } });
    await expect(deployMessengers()).rejects.toThrow(/chain2 returned no contract address/);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED });
  });

  it("reports why the node refused a transaction, and never the key", async () => {
    twoChains();
    rpc.configure({ deployError: "insufficient funds for gas * price + value" });
    const failure = await deployMessengers().catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/insufficient funds/);
    expect((failure as Error).message.toLowerCase()).not.toContain(EWOQ_KEY_HEX);
  });

  it("refuses to sign for an L1 whose RPC answers for another chain", async () => {
    twoChains();
    // avalanche-cli created chain1 with chain ID 1001; its RPC now says Fuji's.
    rpc.setChainId("chain1", 43113);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });
    const failure = await deployMessengers().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(InputError);
    expect((failure as Error).message).toBe(
      "chain1's RPC answers for chain ID 43113, not the chain ID 1001 avalanche-cli created it with: Studio does not sign there",
    );
    expect(rpc.transactions()).toEqual([]);
  });

  it("signs every transaction itself, with the public EWOQ key, for the L1's own chain", async () => {
    // The sandbox PATH holds no executable at all: nothing but this process
    // ever sees the key.
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    rpc.configure({ deploy: { chain1: SHARED, chain2: SHARED } });
    await deployMessengers();
    await sendIcmMessage("chain1", "chain2", "gm");

    const txs = rpc.transactions();
    expect(txs).toHaveLength(5); // 2 deploys, 2 links, 1 message
    for (const tx of txs) {
      expect(tx.from).toBe(EWOQ_ADDRESS);
      expect(tx.chainId).toBe(DEFAULT_CHAIN_ID);
    }
    expect(EWOQ_ADDRESS).toBe("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC");
  });
});

describe("messageProblem", () => {
  it("accepts ordinary text up to the byte limit", () => {
    expect(messageProblem("gm from the other chain")).toBeNull();
    expect(messageProblem("a".repeat(MAX_MESSAGE_BYTES))).toBeNull();
    expect(messageProblem("not a - flag")).toBeNull();
    // Text a command-line parser would have choked on is fine as calldata.
    expect(messageProblem('"quoted"')).toBeNull();
    expect(messageProblem("'")).toBeNull();
  });

  it("measures UTF-8 bytes, not characters", () => {
    // 86 three-byte characters = 258 bytes, although only 86 characters long.
    expect(messageProblem("山".repeat(85))).toBeNull();
    expect(messageProblem("山".repeat(86))).toMatch(/258 bytes.*at most 256/);
    expect(messageProblem("a".repeat(MAX_MESSAGE_BYTES + 1))).toMatch(/257 bytes/);
  });

  it("refuses an empty message and a leading dash", () => {
    expect(messageProblem("")).toBe("message is empty");
    expect(messageProblem("--help")).toBe("message cannot start with '-'");
    expect(messageProblem("-1")).toBe("message cannot start with '-'");
  });
});

describe("sendIcmMessage", () => {
  it("refuses invalid requests before sending anything", async () => {
    deployed();
    const cases: [string, string, string, RegExp][] = [
      ["chain1", "chain1", "gm", /two different chains/],
      ["", "chain2", "gm", /two different chains/],
      ["chain1", "chain2", "", /message is empty/],
      ["chain1", "chain2", "--help", /cannot start with '-'/],
      ["chain1", "chain2", "--async", /cannot start with '-'/],
      ["chain1", "chain2", "x".repeat(257), /257 bytes/],
      ["chain1", "nosuch", "gm", /unknown chain: nosuch/],
    ];
    for (const [from, to, message, expected] of cases) {
      const failure = await sendIcmMessage(from, to, message).catch((e: unknown) => e);
      expect(failure, `${from}->${to} ${message.slice(0, 12)}`).toBeInstanceOf(InputError);
      expect((failure as Error).message).toMatch(expected);
    }
    expect(rpc.transactions()).toEqual([]);
  });

  it("names the reason a chain cannot take part", async () => {
    twoChains();
    sandbox.addL1("myfujil1", { fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: id3.cb58 } });
    sandbox.addL1("stopped", {
      local: { rpcUrl: "http://127.0.0.1:9/stopped/rpc", blockchainId: blockchainId(4).cb58 },
    });
    sandbox.addL1("elsewhere", {
      local: { rpcUrl: "http://203.0.113.7:9650/ext/bc/x/rpc", blockchainId: blockchainId(6).cb58 },
    });
    await expect(sendIcmMessage("chain1", "myfujil1", "gm")).rejects.toThrow(
      "myfujil1 is not deployed on the local network",
    );
    await expect(sendIcmMessage("stopped", "chain1", "gm")).rejects.toThrow(
      "stopped is not running",
    );
    await expect(sendIcmMessage("chain1", "elsewhere", "gm")).rejects.toThrow(
      "elsewhere has an RPC URL that is not on this machine",
    );
    // Both fine, but nothing deployed yet.
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "deploy the messengers first",
    );
    expect(rpc.transactions()).toEqual([]);
  });

  it("refuses to send through a recorded messenger that is gone", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: STALE, chain2: STALE });
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "deploy the messengers first",
    );
    expect(sentMessages()).toEqual([]);
  });

  it("refuses to send through a messenger from before the message-length cap", async () => {
    // Either end being outdated is enough: the old contract asks for too little
    // delivery gas, so a longer message would be sent and never arrive.
    for (const outdated of ["chain1", "chain2"]) {
      const current = outdated === "chain1" ? "chain2" : "chain1";
      twoChains();
      rpc.setOutdated(outdated, OLD);
      rpc.setCode(current, SHARED);
      sandbox.writeIcmState({ [outdated]: OLD, [current]: SHARED });
      const failure = await sendIcmMessage("chain1", "chain2", "gm").catch((e: unknown) => e);
      expect(failure, outdated).toBeInstanceOf(InputError);
      expect((failure as Error).message).toBe("deploy the messengers first");
    }
    expect(rpc.transactions()).toEqual([]);
  });

  it("sends the message as ABI-encoded calldata, signed with the EWOQ key", async () => {
    // Every part of this would mean something to a command-line parser.
    const text = `"quoted" 'single' --rpc-url \\ back\\slash 山 🔺`;
    deployed();
    const result = await sendIcmMessage("chain1", "chain2", text);

    const [sent] = sentMessages();
    expect(sent).toMatchObject({ chain: "chain1", from: EWOQ_ADDRESS });
    expect(sent?.messenger).toBe(SHARED.toLowerCase());
    // The calldata is the whole call: destination chain, destination messenger, text.
    expect(sent?.to).toBe(id2.hex);
    expect(sent?.remote.toLowerCase()).toBe(SHARED.toLowerCase());
    expect(sent?.text).toBe(text);

    // The hash is the one of the transaction the chain received.
    const tx = rpc.transactions().find((t) => t.data.startsWith(SEND_MESSAGE_SELECTOR));
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result).toEqual({ txHash: expect.any(String), receivedBefore: 3 });
    expect(tx?.raw).toBeDefined();
  });

  it("sends a message of exactly the byte limit, multi-byte characters included", async () => {
    const text = `${"山".repeat(85)}a`; // 85 × 3 + 1 = 256 bytes
    deployed();
    await sendIcmMessage("chain1", "chain2", text);
    expect(sentMessages()[0]?.text).toBe(text);
  });

  it("repairs a missing link before sending, so the message can be delivered", async () => {
    // Messengers deployed by a version that skipped linking: live, but unlinked.
    deployed();
    await sendIcmMessage("chain1", "chain2", "gm");
    // The DESTINATION learns to trust the source, then the message goes out.
    expect(rpc.journal()).toEqual(["link chain2", "send begin chain1", "send end chain1"]);
    expect(links()).toEqual([
      { chain: "chain2", messenger: SHARED.toLowerCase(), remoteChain: id1.hex, remote: SHARED },
    ]);

    // Already linked now: the next send does not link again.
    await sendIcmMessage("chain1", "chain2", "gm again");
    expect(rpc.journal().filter((j) => j.startsWith("link"))).toEqual(["link chain2"]);
  });

  it("does not send when the link cannot be verified", async () => {
    // Sending blind is how a message ends up accepted on one chain and dropped on the other.
    deployed();
    rpc.configure({ trustedRemoteError: "header not found" });
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow("header not found");
    expect(rpc.journal()).toEqual([]);
  });

  it("reports a send that was mined but reverted as a failure", async () => {
    deployed();
    await sendIcmMessage("chain1", "chain2", "links the chains first");
    rpc.configure({ receiptStatus: "0x0" });
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "the transaction was mined but reverted",
    );
  });

  it("runs transactions one at a time (they share the dev key's nonce)", async () => {
    deployed();
    rpc.configure({ sendDelayMs: 150 });
    await sendIcmMessage("chain1", "chain2", "warm-up"); // links first
    await Promise.all([
      sendIcmMessage("chain1", "chain2", "one"),
      sendIcmMessage("chain2", "chain1", "two"),
    ]);
    const journal = rpc.journal().filter((j) => j.startsWith("send"));
    expect(journal.slice(2)).toEqual([
      "send begin chain1",
      "send end chain1",
      "send begin chain2",
      "send end chain2",
    ]);
  });

  it("keeps working after a failed transaction", async () => {
    deployed();
    await sendIcmMessage("chain1", "chain2", "links the chains first");
    rpc.configure({ receiptStatus: "0x0" });
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(/reverted/);
    rpc.configure({});
    await expect(sendIcmMessage("chain1", "chain2", "gm")).resolves.toMatchObject({
      txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });
});
