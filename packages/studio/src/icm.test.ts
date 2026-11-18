import { decodeFunctionData, parseAbi } from "viem/utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputError } from "./errors.js";
import {
  deployMessengers,
  getIcmState,
  MAX_MESSAGE_BYTES,
  messageProblem,
  sendIcmMessage,
} from "./icm.js";
import { SEND_MESSAGE_SIG, SET_TRUSTED_REMOTE_SIG } from "./messenger-artifact.js";
import {
  blockchainId,
  createSandbox,
  type FakeRpc,
  type Sandbox,
  SEND_MESSAGE_SELECTOR,
  startFakeRpc,
} from "./testing/sandbox.js";

// The address the dev key deploys to at nonce 0 — the SAME on every fresh L1.
const SHARED = "0x52C84043CD9c865236f11d9Fc9F56aa003c1f922";
const OTHER = "0x17aB05351fC94a1a67Bf3f56DdbB941aE6c63E25";
const STALE = "0x000000000000000000000000000000000000dEaD";
// A messenger an earlier Studio deployed: it has code, but no message-length cap.
const OLD = "0x5DB9A7629912EBF95876228C24A848de0bfB43A9";

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

/** The positionals of a cast invocation (everything after `--`). */
const positionals = (argv: string[]) => argv.slice(argv.indexOf("--") + 1);
const chainOf = (argv: string[]) =>
  new URL(argv[argv.indexOf("--rpc-url") + 1] ?? "").pathname.split("/")[1];
const sends = (sig: string) =>
  sandbox
    .calls("cast")
    .filter((argv) => argv[0] === "send" && positionals(argv)[1] === sig)
    .map((argv) => ({ chain: chainOf(argv), args: positionals(argv) }));
const creates = () => sandbox.calls("cast").filter((argv) => argv.includes("--create"));

const SEND_MESSAGE_ABI = parseAbi([`function ${SEND_MESSAGE_SIG}`]);
/** Every `sendMessage` transaction handed to cast, decoded from its calldata. */
const sentMessages = () =>
  sandbox
    .calls("cast")
    .filter((argv) => argv[0] === "send" && positionals(argv)[1]?.startsWith(SEND_MESSAGE_SELECTOR))
    .map((argv) => {
      const [messenger, calldata, ...rest] = positionals(argv);
      const { args } = decodeFunctionData({
        abi: SEND_MESSAGE_ABI,
        data: calldata as `0x${string}`,
      });
      return {
        chain: chainOf(argv),
        argv,
        messenger,
        rest,
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
    sandbox.fakeCast();

    const state = await getIcmState();
    expect(state.chains.map((c) => c.name)).toEqual(["chain1", "chain2"]);
    expect(state.ready).toBe(true);
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

  it("is not ready with fewer than two eligible L1s", async () => {
    sandbox.addL1("chain1", { local: { rpcUrl: rpc.url("chain1"), blockchainId: id1.cb58 } });
    sandbox.addL1("myfujil1", { fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: id3.cb58 } });
    const state = await getIcmState();
    expect(state.ready).toBe(false);
    expect(state.chains.map((c) => c.name)).toEqual(["chain1"]);
  });

  it("reads the last message of a live messenger", async () => {
    deployed();
    sandbox.fakeCast();
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
    sandbox.fakeCast();
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([null, null]);
    // Nothing was asked of a contract that is not there.
    expect(sandbox.calls("cast")).toEqual([]);
  });

  it("keeps a recorded messenger when the RPC cannot say whether it has code", async () => {
    twoChains();
    rpc.breakCode("chain1");
    rpc.setCode("chain2", SHARED);
    sandbox.writeIcmState({ chain1: SHARED, chain2: SHARED });
    sandbox.fakeCast();
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
    sandbox.fakeCast();
    const state = await getIcmState();
    expect(state.chains.map((c) => [c.name, c.messenger, c.lastMessage])).toEqual([
      ["chain1", null, null],
      ["chain2", SHARED, "hello"],
    ]);
    // Nothing was read from the old contract.
    expect(sandbox.calls("cast").map(chainOf)).toEqual(["chain2", "chain2"]);
  });

  it("recognises a revert under either error code a node reports it with", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: OLD, chain2: OLD });
    sandbox.fakeCast();
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
    sandbox.fakeCast();
    const state = await getIcmState();
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED]);
    expect(rpc.seen).toContain("chain1:eth_call");
  });

  it("returns a received message exactly as it was sent", async () => {
    // cast's own rendering would escape every one of these.
    const text = 'say "hi" \\ back\\slash \ttab — 山 🔺 \u200b';
    deployed();
    sandbox.fakeCast({ lastMessage: text });
    const state = await getIcmState();
    expect(state.chains.map((c) => c.lastMessage)).toEqual([text, text]);
  });

  it("ignores state entries that are not addresses", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: "--rpc-url", chain2: 42 });
    sandbox.fakeCast();
    expect((await getIcmState()).chains.map((c) => c.messenger)).toEqual([null, null]);
    sandbox.writeIcmState(["not", "an", "object"] as never);
    expect((await getIcmState()).chains.map((c) => c.messenger)).toEqual([null, null]);
    expect(sandbox.calls("cast")).toEqual([]);
  });
});

describe("deployMessengers", () => {
  it("links two chains whose messengers have the SAME address", async () => {
    // The default on a fresh devnet: same key, same nonce, so the same address.
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    sandbox.fakeCast({ deploy: { chain1: SHARED, chain2: SHARED } });

    const state = await deployMessengers();

    expect(creates()).toHaveLength(2);
    // Each side registers the other chain's messenger as its trusted remote.
    expect(sends(SET_TRUSTED_REMOTE_SIG)).toEqual([
      { chain: "chain1", args: [SHARED, SET_TRUSTED_REMOTE_SIG, id2.hex, SHARED] },
      { chain: "chain2", args: [SHARED, SET_TRUSTED_REMOTE_SIG, id1.hex, SHARED] },
    ]);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED, chain2: SHARED });
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, SHARED]);
  });

  it("is idempotent: a second run deploys and links nothing", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", SHARED);
    sandbox.fakeCast({ deploy: { chain1: SHARED, chain2: SHARED } });
    await deployMessengers();
    const journal = sandbox.castJournal();
    expect(journal).toEqual(["create chain1", "create chain2", "link chain1", "link chain2"]);

    await deployMessengers();
    expect(sandbox.castJournal()).toEqual(journal);
  });

  it("redeploys and relinks when the recorded messengers are gone", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: STALE, chain2: STALE });
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", OTHER);
    sandbox.fakeCast({ deploy: { chain1: SHARED, chain2: OTHER } });

    const state = await deployMessengers();

    expect(sandbox.castJournal()).toEqual([
      "create chain1",
      "create chain2",
      "link chain1",
      "link chain2",
    ]);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED, chain2: OTHER });
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, OTHER]);
    expect(sends(SET_TRUSTED_REMOTE_SIG)).toEqual([
      { chain: "chain1", args: [SHARED, SET_TRUSTED_REMOTE_SIG, id2.hex, OTHER] },
      { chain: "chain2", args: [OTHER, SET_TRUSTED_REMOTE_SIG, id1.hex, SHARED] },
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
    sandbox.fakeCast({ deploy: { chain2: SHARED, chain3: SHARED } });

    await deployMessengers();

    expect(sandbox.castJournal().filter((j) => j.startsWith("create"))).toEqual([
      "create chain2",
      "create chain3",
    ]);
    // 3 chains, each trusting the 2 others.
    expect(sends(SET_TRUSTED_REMOTE_SIG).map((s) => `${s.chain} trusts ${s.args[2]}`)).toEqual([
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
    sandbox.fakeCast({ deploy: { chain1: SHARED, chain2: SHARED } });
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
    sandbox.fakeCast();
    await deployMessengers();
    expect(sandbox.castJournal()).toEqual(["link chain1", "link chain2"]);

    // Seen for what they are — no MAX_MESSAGE_LENGTH — they count as missing …
    rpc.setOutdated("chain1", OLD);
    rpc.setOutdated("chain2", OLD);
    expect((await getIcmState()).chains.map((c) => c.messenger)).toEqual([null, null]);

    // … and the next deploy puts current ones in their place.
    rpc.setCode("chain1", SHARED);
    rpc.setCode("chain2", OTHER);
    sandbox.fakeCast({ deploy: { chain1: SHARED, chain2: OTHER } });
    const state = await deployMessengers();

    expect(sandbox.castJournal().slice(2)).toEqual([
      "create chain1",
      "create chain2",
      "link chain1",
      "link chain2",
    ]);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED, chain2: OTHER });
    expect(state.chains.map((c) => c.messenger)).toEqual([SHARED, OTHER]);
    // Each new messenger trusts the other NEW one, not the one it replaced.
    expect(sends(SET_TRUSTED_REMOTE_SIG).slice(2)).toEqual([
      { chain: "chain1", args: [SHARED, SET_TRUSTED_REMOTE_SIG, id2.hex, OTHER] },
      { chain: "chain2", args: [OTHER, SET_TRUSTED_REMOTE_SIG, id1.hex, SHARED] },
    ]);
  });

  it("replaces only the outdated messenger and points the current one at its successor", async () => {
    twoChains();
    rpc.setCode("chain1", OLD);
    rpc.setCode("chain2", SHARED);
    sandbox.writeIcmState({ chain1: OLD, chain2: SHARED });
    sandbox.fakeCast();
    await deployMessengers(); // chain2's messenger now trusts OLD on chain1

    rpc.setOutdated("chain1", OLD);
    rpc.setCode("chain1", OTHER);
    sandbox.fakeCast({ deploy: { chain1: OTHER } });
    await deployMessengers();

    expect(sandbox.castJournal().slice(2)).toEqual(["create chain1", "link chain1", "link chain2"]);
    expect(sandbox.readIcmState()).toEqual({ chain1: OTHER, chain2: SHARED });
    expect(sends(SET_TRUSTED_REMOTE_SIG).slice(2)).toEqual([
      { chain: "chain1", args: [OTHER, SET_TRUSTED_REMOTE_SIG, id2.hex, SHARED] },
      { chain: "chain2", args: [SHARED, SET_TRUSTED_REMOTE_SIG, id1.hex, OTHER] },
    ]);
  });

  it("refuses to record a messenger it would not call usable itself", async () => {
    // The bytecode Studio ships and its own "is this messenger current?" check
    // must agree. If a deploy produces a contract without the cap, say so —
    // recording it would only lead to "no messenger here" on the next look.
    twoChains();
    rpc.setOutdated("chain1", OLD);
    sandbox.fakeCast({ deploy: { chain1: OLD, chain2: OLD } });
    await expect(deployMessengers()).rejects.toThrow(
      "the messenger deployed on chain1 has no message-length cap: this build of Studio ships outdated messenger bytecode",
    );
    expect(sandbox.castJournal()).toEqual(["create chain1"]);
    expect(sandbox.readIcmState()).toEqual({});
  });

  it("fails when a transaction is mined but reverted, and records nothing", async () => {
    twoChains();
    sandbox.fakeCast({ deploy: { chain1: SHARED, chain2: SHARED }, receiptStatus: "0x0" });
    await expect(deployMessengers()).rejects.toThrow("the transaction was mined but reverted");
    expect(sandbox.readIcmState()).toEqual({});
  });

  it("fails when a link cannot be read, instead of assuming it is there", async () => {
    deployed();
    sandbox.fakeCast({ trustedRemoteError: "Error: error sending request for url" });
    await expect(deployMessengers()).rejects.toThrow("error sending request for url");
    expect(sandbox.castJournal()).toEqual([]);
  });

  it("records each deployed address at once, so a later failure cannot lose it", async () => {
    twoChains();
    rpc.setCode("chain1", SHARED);
    // chain2's deploy "succeeds" without an address.
    sandbox.fakeCast({ deploy: { chain1: SHARED } });
    await expect(deployMessengers()).rejects.toThrow(/chain2 returned no contract address/);
    expect(sandbox.readIcmState()).toEqual({ chain1: SHARED });
  });

  it("reports why cast failed, without echoing the command line", async () => {
    twoChains();
    sandbox.fakeCast({ deployError: "Error: insufficient funds for gas" });
    const failure = await deployMessengers().catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Error: insufficient funds for gas");
    expect((failure as Error).message).not.toContain("--private-key");
  });

  it("says so when cast is not installed", async () => {
    twoChains();
    await expect(deployMessengers()).rejects.toThrow(/cast is not installed/);
  });
});

describe("messageProblem", () => {
  it("accepts ordinary text up to the byte limit", () => {
    expect(messageProblem("gm from the other chain")).toBeNull();
    expect(messageProblem("a".repeat(MAX_MESSAGE_BYTES))).toBeNull();
    expect(messageProblem("not a - flag")).toBeNull();
    // Text that cast would have parsed or rejected as an argument is fine as calldata.
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
  it("refuses invalid requests before running anything", async () => {
    deployed();
    sandbox.fakeCast();
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
    expect(sandbox.calls("cast")).toEqual([]);
  });

  it("names the reason a chain cannot take part", async () => {
    twoChains();
    sandbox.addL1("myfujil1", { fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: id3.cb58 } });
    sandbox.addL1("stopped", {
      local: { rpcUrl: "http://127.0.0.1:9/stopped/rpc", blockchainId: blockchainId(4).cb58 },
    });
    sandbox.fakeCast();
    await expect(sendIcmMessage("chain1", "myfujil1", "gm")).rejects.toThrow(
      "myfujil1 is not deployed on the local network",
    );
    await expect(sendIcmMessage("stopped", "chain1", "gm")).rejects.toThrow(
      "stopped is not running",
    );
    // Both fine, but nothing deployed yet.
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "deploy the messengers first",
    );
  });

  it("refuses to send through a recorded messenger that is gone", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: STALE, chain2: STALE });
    sandbox.fakeCast();
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
      sandbox.fakeCast();
      const failure = await sendIcmMessage("chain1", "chain2", "gm").catch((e: unknown) => e);
      expect(failure, outdated).toBeInstanceOf(InputError);
      expect((failure as Error).message).toBe("deploy the messengers first");
    }
    expect(sandbox.calls("cast")).toEqual([]);
  });

  it("hands cast the message as ABI-encoded calldata, never as text", async () => {
    // Every part of this would mean something to cast's own argument parser.
    const text = `"quoted" 'single' --rpc-url \\ back\\slash 山 🔺`;
    deployed();
    sandbox.fakeCast();
    const result = await sendIcmMessage("chain1", "chain2", text);
    expect(result).toEqual({ txHash: "0xfeed", receivedBefore: 3 });

    const [sent] = sentMessages();
    expect(sent).toMatchObject({ chain: "chain1", messenger: SHARED, rest: [] });
    // The calldata is the whole call: destination chain, destination messenger, text.
    expect(sent?.to).toBe(id2.hex);
    expect(sent?.remote.toLowerCase()).toBe(SHARED.toLowerCase());
    expect(sent?.text).toBe(text);

    const argv = sent?.argv ?? [];
    const split = argv.indexOf("--");
    // Options only before the separator …
    expect(argv.slice(0, split)).toEqual([
      "send",
      "--rpc-url",
      rpc.url("chain1"),
      "--private-key",
      expect.stringMatching(/^0x[0-9a-f]{64}$/),
      "--json",
    ]);
    // … and after it nothing but an address and hex.
    expect(argv.slice(split + 1)).toEqual([SHARED, expect.stringMatching(/^0x[0-9a-f]+$/)]);
    for (const piece of ["quoted", "single", "back", "山"]) {
      expect(argv.join(" "), piece).not.toContain(piece);
    }
  });

  it("sends a message of exactly the byte limit, multi-byte characters included", async () => {
    const text = `${"山".repeat(85)}a`; // 85 × 3 + 1 = 256 bytes
    deployed();
    sandbox.fakeCast();
    await sendIcmMessage("chain1", "chain2", text);
    expect(sentMessages()[0]?.text).toBe(text);
  });

  it("repairs a missing link before sending, so the message can be delivered", async () => {
    // Messengers deployed by a version that skipped linking: live, but unlinked.
    deployed();
    sandbox.fakeCast();
    await sendIcmMessage("chain1", "chain2", "gm");
    // The DESTINATION learns to trust the source, then the message goes out.
    expect(sandbox.castJournal()).toEqual(["link chain2", "send begin chain1", "send end chain1"]);
    expect(sends(SET_TRUSTED_REMOTE_SIG)).toEqual([
      { chain: "chain2", args: [SHARED, SET_TRUSTED_REMOTE_SIG, id1.hex, SHARED] },
    ]);

    // Already linked now: the next send does not link again.
    await sendIcmMessage("chain1", "chain2", "gm again");
    expect(sandbox.castJournal().filter((j) => j.startsWith("link"))).toEqual(["link chain2"]);
  });

  it("does not send when the link cannot be verified", async () => {
    // Sending blind is how a message ends up accepted on one chain and dropped on the other.
    deployed();
    sandbox.fakeCast({ trustedRemoteError: "Error: error sending request for url" });
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "error sending request for url",
    );
    expect(sandbox.castJournal()).toEqual([]);
  });

  it("reports a send that was mined but reverted as a failure", async () => {
    deployed();
    sandbox.fakeCast();
    await sendIcmMessage("chain1", "chain2", "links the chains first");
    sandbox.fakeCast({ receiptStatus: "0x0" });
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(
      "the transaction was mined but reverted",
    );
  });

  it("runs transactions one at a time (they share the dev key's nonce)", async () => {
    deployed();
    sandbox.fakeCast({ sendDelayMs: 150 });
    await sendIcmMessage("chain1", "chain2", "warm-up"); // links first
    await Promise.all([
      sendIcmMessage("chain1", "chain2", "one"),
      sendIcmMessage("chain2", "chain1", "two"),
    ]);
    const journal = sandbox.castJournal().filter((j) => j.startsWith("send"));
    expect(journal.slice(2)).toEqual([
      "send begin chain1",
      "send end chain1",
      "send begin chain2",
      "send end chain2",
    ]);
  });

  it("keeps working after a failed transaction", async () => {
    deployed();
    await expect(sendIcmMessage("chain1", "chain2", "gm")).rejects.toThrow(/cast is not installed/);
    sandbox.fakeCast();
    await expect(sendIcmMessage("chain1", "chain2", "gm")).resolves.toMatchObject({
      txHash: "0xfeed",
    });
  });
});
