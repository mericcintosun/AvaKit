import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { parseEther, parseTransaction } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  connect,
  DripSender,
  describeError,
  FaucetConfigError,
  FaucetEmptyError,
  MAX_SEND_ATTEMPTS,
  NONCE_SETTLE_MS,
} from "../src/sender.js";
import { CHAIN_ID, startMockChain } from "./helpers/mock-chain.mjs";

const DRIP = parseEther("0.02");
/** Where the mock chain starts every account. */
const FIRST_NONCE = 7;

const chain = await startMockChain();
after(() => chain.close());
beforeEach(() => {
  chain.reset();
  chain.balance = parseEther("1");
});

const someAddress = () => privateKeyToAccount(generatePrivateKey()).address;

/** A faucet account nobody has used yet, and a way to build senders for it. */
function freshFaucet() {
  const env = { FAUCET_FUJI_RPC: chain.url, AVAKIT_FAUCET_KEY: generatePrivateKey() };
  const { address } = privateKeyToAccount(env.AVAKIT_FAUCET_KEY);
  // Each call stands for a new instance of the Durable Object: same key, no memory.
  return { address, sender: () => new DripSender(connect(CHAIN_ID, env)) };
}

async function drip(sender, to = someAddress()) {
  return sender.broadcast(await sender.prepare({ to, value: DRIP }));
}

const nonces = () => chain.accepted.map((tx) => tx.nonce);

describe("DripSender", () => {
  it("sends a Fuji transfer of the drip to the recipient", async () => {
    const faucet = freshFaucet();
    const to = someAddress();

    const hash = await drip(faucet.sender(), to);

    assert.equal(chain.accepted.length, 1);
    const [sent] = chain.accepted;
    assert.equal(sent.hash, hash);
    assert.equal(sent.from, faucet.address);
    assert.equal(sent.to.toLowerCase(), to.toLowerCase());
    assert.equal(sent.value, DRIP);
    assert.equal(parseTransaction(sent.raw).chainId, CHAIN_ID);
  });

  it("gives concurrent drips consecutive nonces", async () => {
    // Without the queue every one of these reads the same pending count, signs
    // the same nonce, and all but one are rejected.
    const sender = freshFaucet().sender();
    chain.delay = 5;

    const hashes = await Promise.all(Array.from({ length: 12 }, () => drip(sender)));

    assert.equal(new Set(hashes).size, 12);
    assert.deepEqual(
      nonces(),
      Array.from({ length: 12 }, (_, i) => FIRST_NONCE + i),
    );
    assert.equal(chain.count("eth_sendRawTransaction"), 12, "no drip needed a second attempt");
  });

  it("skips a nonce the answering node has not counted yet", async () => {
    const sender = freshFaucet().sender();
    await drip(sender);

    // A load-balanced RPC: this node is one transaction behind the one that took it.
    chain.lag = 1;
    await drip(sender);

    assert.deepEqual(nonces(), [FIRST_NONCE, FIRST_NONCE + 1]);
    assert.equal(chain.count("eth_sendRawTransaction"), 2, "the stale count cost no retry");
  });

  it("moves past a nonce that turns out to be taken", async () => {
    // A fresh object (no memory) asking a node that is two behind: both stale
    // nonces are refused as "nonce too low" before the third attempt lands.
    const faucet = freshFaucet();
    await drip(faucet.sender());
    await drip(faucet.sender());
    chain.lag = 2;

    const hash = await drip(faucet.sender());

    assert.equal(chain.accepted.at(-1).hash, hash);
    assert.deepEqual(nonces(), [FIRST_NONCE, FIRST_NONCE + 1, FIRST_NONCE + 2]);
  });

  it("moves past a nonce held by a pending transaction", async () => {
    const faucet = freshFaucet();
    chain.autoMine = false;
    await drip(faucet.sender());

    // The node answers with the mined count only, so the fresh object collides
    // with the pending drip: "replacement transaction underpriced".
    chain.lag = 1;
    await drip(faucet.sender());

    assert.deepEqual(nonces(), [FIRST_NONCE, FIRST_NONCE + 1]);
  });

  it("treats a transaction the node already holds as sent, not as a conflict", async () => {
    const faucet = freshFaucet();
    const to = someAddress();
    chain.autoMine = false;
    const first = await drip(faucet.sender(), to);

    // The same drip, signed again by an object that forgot the first attempt.
    chain.lag = 1;
    const second = await drip(faucet.sender(), to);

    assert.equal(second, first);
    assert.equal(chain.accepted.length, 1, "the recipient is not paid twice");
  });

  it("gives up after a few attempts and still serves the next drip", async () => {
    const faucet = freshFaucet();
    for (let i = 0; i < MAX_SEND_ATTEMPTS + 1; i += 1) await drip(faucet.sender());
    const sender = faucet.sender();
    chain.lag = MAX_SEND_ATTEMPTS + 1;

    await assert.rejects(drip(sender), /nonce too low/i);

    chain.lag = 0;
    await drip(sender);
    assert.equal(chain.accepted.length, MAX_SEND_ATTEMPTS + 2);
  });

  it("reuses the nonce of a transaction that was dropped, once it is clearly gone", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 18) });
    const faucet = freshFaucet();
    const sender = faucet.sender();
    chain.autoMine = false;

    await drip(sender);
    chain.drop(faucet.address, FIRST_NONCE);

    // A moment later the gap is indistinguishable from a node that is behind,
    // so the next drip queues after it…
    await drip(sender);
    // …but once the nonce has gone uncounted for long enough it is used again,
    // which also frees the drip stuck behind it.
    t.mock.timers.tick(NONCE_SETTLE_MS);
    await drip(sender);

    assert.deepEqual(nonces(), [FIRST_NONCE, FIRST_NONCE + 1, FIRST_NONCE]);
    chain.mine();
    assert.equal(chain.nonceOf(faucet.address), FIRST_NONCE + 2);
  });

  it("does not let one failed send block the drips behind it", async () => {
    const sender = freshFaucet().sender();
    chain.fail("eth_sendRawTransaction", { status: 500 });

    const results = await Promise.allSettled([drip(sender), drip(sender), drip(sender)]);

    // Whichever drip reached the queue first hit the failure; the other two go out.
    assert.deepEqual(results.map((result) => result.status).sort(), [
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    assert.deepEqual(nonces(), [FIRST_NONCE, FIRST_NONCE + 1]);
  });

  it("works with a node that fills the transaction in itself", async () => {
    // geth answers eth_fillTransaction, and viem prefers it when it is there.
    // The node then proposes a nonce too — the same one to every caller.
    const sender = freshFaucet().sender();
    chain.fills = true;
    chain.delay = 5;

    const hashes = await Promise.all(Array.from({ length: 4 }, () => drip(sender)));

    assert.equal(new Set(hashes).size, 4);
    assert.ok(chain.count("eth_fillTransaction") >= 4);
    assert.deepEqual(
      nonces(),
      Array.from({ length: 4 }, (_, i) => FIRST_NONCE + i),
    );
  });

  it("never signs for another chain, whatever the RPC claims to be", async () => {
    // FAUCET_FUJI_RPC pointed at Avalanche mainnet by mistake. The allowlist is
    // only worth something if the key cannot sign a mainnet transaction.
    const sender = freshFaucet().sender();
    chain.chainId = 43114;

    // A node that fills the transaction says which chain it is on: refuse early.
    chain.fills = true;
    await assert.rejects(drip(sender), (e) => {
      assert.ok(e instanceof FaucetConfigError);
      assert.equal(e.message, "The faucet's RPC answers for chain 43114, not 43113.");
      return true;
    });
    assert.deepEqual(chain.signedFor, []);

    // One that does not is still only ever handed a Fuji transaction, which a
    // mainnet node cannot accept.
    chain.fills = false;
    await assert.rejects(drip(sender), /invalid chain id for signer/);
    assert.deepEqual(chain.signedFor, [CHAIN_ID]);
    assert.equal(chain.accepted.length, 0);
  });

  it("reports an account that cannot afford the drip as empty", async () => {
    const sender = freshFaucet().sender();

    chain.balance = DRIP - 1n;
    await assert.rejects(drip(sender), FaucetEmptyError);

    // Enough for the value but not for the gas on top of it.
    chain.balance = DRIP + 1n;
    await assert.rejects(drip(sender), FaucetEmptyError);

    assert.equal(chain.count("eth_sendRawTransaction"), 0);
  });

  it("reports a balance that ran out between preparing and sending as empty", async () => {
    const sender = freshFaucet().sender();
    const request = await sender.prepare({ to: someAddress(), value: DRIP });
    chain.balance = 0n;

    await assert.rejects(sender.broadcast(request), FaucetEmptyError);
  });
});

describe("connect", () => {
  it("refuses a chain that is not on the testnet allowlist", () => {
    const env = { AVAKIT_FAUCET_KEY: generatePrivateKey() };
    assert.equal(connect(43114, env), null);
    assert.equal(connect(1, env), null);
    assert.equal(connect("constructor", env), null);
    assert.ok(connect(CHAIN_ID, env));
  });

  it("explains an unusable key without repeating it", () => {
    for (const key of ["0x1234", "not-a-key", `0x${"00".repeat(32)}`, undefined]) {
      assert.throws(
        () => connect(CHAIN_ID, { AVAKIT_FAUCET_KEY: key }),
        (e) => {
          assert.ok(e instanceof FaucetConfigError);
          assert.equal(e.message, "Faucet key is not a valid private key.");
          assert.equal(e.cause, undefined);
          return true;
        },
      );
    }
  });
});

describe("describeError", () => {
  it("keeps the RPC URL and its API key out of the log", async () => {
    const sender = freshFaucet().sender();
    const request = await sender.prepare({ to: someAddress(), value: DRIP });

    for (const failure of [{ status: 500 }, { error: { code: -32000, message: "boom" } }]) {
      chain.fail("eth_sendRawTransaction", failure);
      const error = await sender.broadcast(request).catch((e) => e);
      assert.match(error.message, /SECRETPATHKEY/, "viem itself prints the URL");

      const logged = JSON.stringify(describeError(error, chain.url));
      assert.doesNotMatch(logged, /SECRET|apikey|127\.0\.0\.1/);
      assert.match(logged, /"error":"\w+Error"/);
    }
  });

  it("redacts a key that an upstream echoes back on its own", () => {
    const error = Object.assign(new Error("request failed"), {
      details: "invalid project id SECRETPATHKEY0123456789",
    });
    assert.deepEqual(describeError(error, chain.url), {
      error: "Error",
      detail: "request failed",
      node: "invalid project id [redacted]",
    });
  });

  it("copes with things that are not errors", () => {
    assert.deepEqual(describeError("nope", chain.url), { error: "unknown" });
    assert.deepEqual(describeError(new TypeError("x is not a function")), {
      error: "TypeError",
      detail: "x is not a function",
    });
  });
});
