import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, startMockChain } from "./helpers/mock-chain.mjs";
import { createFaucet } from "./helpers/runtime.mjs";

/**
 * The `Faucet` Durable Object's daily budgets, with a clock the test moves:
 * workerd cannot be taken to 23:59 UTC, so the object is built in plain Node
 * here. (worker.test.mjs runs the same class for real, through HTTP.)
 */

const LATE = Date.UTC(2026, 10, 18, 23, 59, 0);

const chain = await startMockChain();
after(() => chain.close());
beforeEach(() => chain.reset());

const env = (overrides = {}) => ({
  AVAKIT_FAUCET_KEY: generatePrivateKey(),
  FAUCET_FUJI_RPC: chain.url,
  FAUCET_DRIP_AVAX: "0.02",
  FAUCET_DAILY_DRIPS: "2",
  FAUCET_DAILY_DRIPS_VERIFIED: "1",
  ...overrides,
});
let clients = 0;
const drip = (faucet, lane) =>
  faucet.drip({
    chainId: CHAIN_ID,
    to: privateKeyToAccount(generatePrivateKey()).address,
    client: `198.18.1.${++clients}`,
    lane,
  });

describe("the Faucet object's daily budgets", () => {
  it("stop the day's drips at the budget and start over at 00:00 UTC", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: LATE });
    const { faucet } = createFaucet(env());

    assert.equal((await drip(faucet)).ok, true);
    assert.equal((await drip(faucet)).ok, true);
    assert.deepEqual(await drip(faucet), { ok: false, code: "daily_limited", retryAfter: 60 });
    assert.equal(chain.accepted.length, 2);

    t.mock.timers.tick(60 * 1000);
    assert.equal((await drip(faucet)).ok, true);
    assert.deepEqual(faucet.usage(), {
      day: "2026-11-19",
      unverified: { drips: 1, max: 2 },
      verified: { drips: 0, max: 1 },
    });
  });

  it("draw a verified drip on the verified budget alone", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: LATE });
    const { faucet } = createFaucet(env());

    assert.equal((await drip(faucet, "verified")).ok, true);
    assert.equal((await drip(faucet, "verified")).code, "daily_limited");
    assert.equal((await drip(faucet)).ok, true);
    assert.deepEqual(faucet.usage(), {
      day: "2026-11-18",
      unverified: { drips: 1, max: 2 },
      verified: { drips: 1, max: 1 },
    });
  });

  it("count a drip that names no budget, or one it does not know, as unverified", async (t) => {
    // A Worker from before the budgets sends no lane while a deploy rolls out.
    t.mock.timers.enable({ apis: ["Date"], now: LATE });
    const { faucet } = createFaucet(env());

    assert.equal((await drip(faucet, undefined)).ok, true);
    assert.equal((await drip(faucet, "admin")).ok, true);
    assert.equal((await drip(faucet, "verified")).ok, true);
    assert.equal((await drip(faucet, "admin")).code, "daily_limited");
  });

  it("refuse to drip on a budget they cannot read, and send nothing", async () => {
    const { faucet } = createFaucet(env({ FAUCET_DAILY_DRIPS: "lots" }));

    assert.deepEqual(await drip(faucet), {
      ok: false,
      code: "misconfigured",
      message: "FAUCET_DAILY_DRIPS is not a whole number.",
    });
    assert.deepEqual(chain.calls, []);
  });
});
