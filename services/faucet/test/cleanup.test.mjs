import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ADDRESS_WINDOW_MS, FAILURE_WINDOW_MS, IP_WINDOW_MS } from "../src/limits.js";
import { CHAIN_ID, startMockChain } from "./helpers/mock-chain.mjs";
import { createFaucet } from "./helpers/runtime.mjs";

/**
 * The `Faucet` Durable Object's alarm. Nothing in workerd lets a test fire an
 * alarm an hour early, so the object is built in plain Node here, with a clock
 * the test moves. (worker.test.mjs runs the same class for real.)
 */

const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);

const chain = await startMockChain();
after(() => chain.close());
beforeEach(() => chain.reset());

const env = () => ({
  AVAKIT_FAUCET_KEY: generatePrivateKey(),
  FAUCET_FUJI_RPC: chain.url,
  FAUCET_DRIP_AVAX: "0.02",
});
const someAddress = () => privateKeyToAccount(generatePrivateKey()).address;
const drip = (faucet, client) => faucet.drip({ chainId: CHAIN_ID, to: someAddress(), client });
const stored = (storage, table) => storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n;

describe("the Faucet object's alarm", () => {
  it("forgets a client an hour after its drip, even if nobody else ever asks", async (t) => {
    // Old rows are cleared by the next drip — which, after the last drip of
    // the day, would leave that visitor's address in storage until morning.
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    const { faucet, storage, fireAlarm } = createFaucet(env());

    assert.equal((await drip(faucet, "203.0.113.9")).ok, true);
    assert.equal(storage.alarm, T0 + IP_WINDOW_MS);
    assert.equal(stored(storage, "hits"), 1);

    t.mock.timers.tick(IP_WINDOW_MS);
    await fireAlarm();
    assert.equal(stored(storage, "hits"), 0);
    // The drip itself still counts against its address, so come back for it.
    assert.equal(stored(storage, "drips"), 1);
    assert.equal(storage.alarm, T0 + ADDRESS_WINDOW_MS);

    t.mock.timers.tick(ADDRESS_WINDOW_MS - IP_WINDOW_MS);
    await fireAlarm();
    assert.equal(stored(storage, "drips"), 0);
    assert.equal(storage.alarm, null, "nothing is stored, so nothing is scheduled");
  });

  it("keeps the earliest alarm when drips keep arriving", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    const { faucet, storage, fireAlarm } = createFaucet(env());

    await drip(faucet, "203.0.113.9");
    t.mock.timers.tick(20 * MINUTE);
    await drip(faucet, "198.51.100.7");
    assert.equal(storage.alarm, T0 + IP_WINDOW_MS, "the first drip is still the first to age out");

    t.mock.timers.tick(40 * MINUTE);
    await fireAlarm();
    assert.equal(storage.alarm, T0 + 20 * MINUTE + IP_WINDOW_MS);

    // An alarm set far ahead (for an address row) is pulled in by a new drip.
    t.mock.timers.tick(20 * MINUTE);
    await fireAlarm();
    assert.equal(storage.alarm, T0 + ADDRESS_WINDOW_MS);
    await drip(faucet, "192.0.2.44");
    assert.equal(storage.alarm, T0 + 80 * MINUTE + IP_WINDOW_MS);
  });

  it("forgets a failed attempt five minutes on, and keeps nothing else of it", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    t.mock.method(console, "error", () => {});
    const { faucet, storage, fireAlarm } = createFaucet(env());
    chain.fail("eth_sendRawTransaction", { error: { code: -32000, message: "boom" } });

    assert.deepEqual(await drip(faucet, "203.0.113.9"), { ok: false, code: "drip_failed" });
    assert.deepEqual([stored(storage, "hits"), stored(storage, "drips")], [0, 0]);
    // The client is remembered just long enough to count its failures.
    assert.equal(stored(storage, "failures"), 1);
    assert.equal(storage.alarm, T0 + FAILURE_WINDOW_MS);

    t.mock.timers.tick(FAILURE_WINDOW_MS);
    await fireAlarm();
    assert.equal(stored(storage, "failures"), 0);
    assert.equal(storage.alarm, null);
  });

  it("pulls the alarm in for a failed attempt when only drips were stored", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    t.mock.method(console, "error", () => {});
    const { faucet, storage, fireAlarm } = createFaucet(env());

    await drip(faucet, "203.0.113.9");
    assert.equal(storage.alarm, T0 + IP_WINDOW_MS);
    t.mock.timers.tick(MINUTE);
    chain.fail("eth_estimateGas", { error: { code: -32000, message: "boom" } });
    await drip(faucet, "198.51.100.7");
    assert.equal(storage.alarm, T0 + MINUTE + FAILURE_WINDOW_MS);

    // Once the failure is gone, the alarm goes back to waiting for the drip.
    t.mock.timers.tick(FAILURE_WINDOW_MS);
    await fireAlarm();
    assert.equal(stored(storage, "failures"), 0);
    assert.equal(storage.alarm, T0 + IP_WINDOW_MS);
  });
});
