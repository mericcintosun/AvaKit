import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESS_WINDOW_MS,
  BUSY_RETRY_S,
  DripLimits,
  FAILURE_MAX,
  FAILURE_WINDOW_MS,
  IP_MAX,
  IP_WINDOW_MS,
} from "../src/limits.js";
import { memorySql } from "./helpers/sql.mjs";

const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const CLIENT = "203.0.113.9";

let counter = 0;
/** A fresh, never-funded address. */
const address = () => `0x${(++counter).toString(16).padStart(40, "0")}`;

/** Reserve and settle `n` drips to fresh addresses from `client` at `now`. */
function drip(limits, client, now, n = 1) {
  for (let i = 0; i < n; i += 1) {
    const reservation = limits.reserve({ address: address(), client }, now);
    assert.ok("id" in reservation, `drip ${i + 1} of ${n} was refused`);
    limits.settle(reservation.id);
  }
}

describe("the per-address limit", () => {
  it("allows one drip per address in any 24 hours", () => {
    const limits = new DripLimits(memorySql());
    const who = address();

    const first = limits.reserve({ address: who, client: CLIENT }, T0);
    limits.settle(first.id);

    // A different client asking for the same address changes nothing.
    assert.deepEqual(limits.reserve({ address: who, client: "198.51.100.7" }, T0 + MINUTE), {
      refused: { code: "address_limited", retryAfter: 24 * 60 * 60 - 60 },
    });
    assert.deepEqual(limits.refusal({ address: who, client: CLIENT }, T0 + ADDRESS_WINDOW_MS - 1), {
      code: "address_limited",
      retryAfter: 1,
    });

    assert.equal(limits.refusal({ address: who, client: CLIENT }, T0 + ADDRESS_WINDOW_MS), null);
    assert.ok("id" in limits.reserve({ address: who, client: CLIENT }, T0 + ADDRESS_WINDOW_MS));
  });

  it("asks a second request to come back in a moment while the first is still being sent", () => {
    const limits = new DripLimits(memorySql());
    const who = address();
    const busy = { code: "faucet_busy", retryAfter: BUSY_RETRY_S };

    // Not the 24-hour refusal: nobody knows yet whether this drip will go out.
    const first = limits.reserve({ address: who, client: CLIENT }, T0);
    assert.deepEqual(limits.refusal({ address: who, client: CLIENT }, T0), busy);
    assert.deepEqual(limits.reserve({ address: who, client: "198.51.100.7" }, T0), {
      refused: busy,
    });

    // It fails: the address is free again.
    limits.release(first.id);
    assert.equal(limits.refusal({ address: who, client: CLIENT }, T0), null);

    // It goes out: now the address has been funded.
    const second = limits.reserve({ address: who, client: CLIENT }, T0);
    limits.settle(second.id);
    assert.deepEqual(limits.refusal({ address: who, client: CLIENT }, T0), {
      code: "address_limited",
      retryAfter: 24 * 60 * 60,
    });
  });
});

describe("the per-IP limit", () => {
  it(`allows ${IP_MAX} drips per client and refuses the next`, () => {
    const limits = new DripLimits(memorySql());
    drip(limits, CLIENT, T0, IP_MAX);

    assert.deepEqual(limits.reserve({ address: address(), client: CLIENT }, T0 + MINUTE), {
      refused: { code: "ip_limited", retryAfter: 59 * 60 },
    });
    // Somebody else is not affected.
    assert.ok("id" in limits.reserve({ address: address(), client: "198.51.100.7" }, T0 + MINUTE));
  });

  it("never blocks a client that stays under the limit, however long it keeps going", () => {
    // The old KV counter pushed its own expiry back an hour on every drip, so it
    // only ever cleared after a full hour of silence: a workshop funding one
    // wallet every ten minutes (6 an hour) was locked out after its 20th drip,
    // 3h10m in. Each hit now expires on its own schedule.
    const limits = new DripLimits(memorySql());
    for (let i = 0; i < 60; i += 1) {
      const now = T0 + i * 10 * MINUTE;
      const reservation = limits.reserve({ address: address(), client: CLIENT }, now);
      assert.ok("id" in reservation, `drip ${i + 1} (${i * 10} minutes in) was refused`);
      limits.settle(reservation.id);
    }
  });

  it("stops counting a hit exactly one window after it was made", () => {
    const limits = new DripLimits(memorySql());
    drip(limits, CLIENT, T0, 5);
    drip(limits, CLIENT, T0 + 30 * MINUTE, IP_MAX - 5);

    const justBefore = T0 + IP_WINDOW_MS - 1;
    assert.deepEqual(limits.refusal({ address: address(), client: CLIENT }, justBefore), {
      code: "ip_limited",
      retryAfter: 1,
    });

    // The five early hits lapse together; the fifteen later ones still count.
    drip(limits, CLIENT, T0 + IP_WINDOW_MS, 5);
    assert.deepEqual(limits.refusal({ address: address(), client: CLIENT }, T0 + IP_WINDOW_MS), {
      code: "ip_limited",
      retryAfter: 30 * 60,
    });
  });
});

describe("a failed drip", () => {
  it("hands back both the address and the per-IP allowance", () => {
    const limits = new DripLimits(memorySql());
    drip(limits, CLIENT, T0, IP_MAX - 1);

    const who = address();
    const failed = limits.reserve({ address: who, client: CLIENT }, T0);
    assert.equal(limits.refusal({ address: address(), client: CLIENT }, T0).code, "ip_limited");
    limits.release(failed.id);

    // The same address can try again at once, and it is still the 20th drip.
    const retry = limits.reserve({ address: who, client: CLIENT }, T0);
    assert.ok("id" in retry);
    limits.settle(retry.id);
    assert.equal(
      limits.reserve({ address: address(), client: CLIENT }, T0).refused.code,
      "ip_limited",
    );
  });

  it("is forgotten when the object restarts mid-send, but a sent one is not", () => {
    const sql = memorySql();
    const before = new DripLimits(sql);
    const sent = address();
    const interrupted = address();
    before.settle(before.reserve({ address: sent, client: CLIENT }, T0).id);
    before.reserve({ address: interrupted, client: CLIENT }, T0);

    // A new instance of the Durable Object over the same storage.
    const after = new DripLimits(sql);
    assert.equal(after.refusal({ address: sent, client: CLIENT }, T0).code, "address_limited");
    assert.equal(after.refusal({ address: interrupted, client: CLIENT }, T0), null);
    assert.equal(sql.exec("SELECT COUNT(*) AS n FROM hits").one().n, 1);
  });
});

describe("failed attempts", () => {
  const OTHER = "198.51.100.7";

  it(`get a client refused after ${FAILURE_MAX} in five minutes, until they age out`, () => {
    const limits = new DripLimits(memorySql());
    for (let i = 1; i < FAILURE_MAX; i += 1) limits.fail({ client: CLIENT }, T0);
    assert.equal(limits.refusal({ address: address(), client: CLIENT }, T0), null);

    limits.fail({ client: CLIENT }, T0 + MINUTE);

    const refused = { code: "ip_limited", retryAfter: 4 * 60 };
    assert.deepEqual(limits.refusal({ address: address(), client: CLIENT }, T0 + MINUTE), refused);
    assert.deepEqual(limits.reserve({ address: address(), client: CLIENT }, T0 + MINUTE), {
      refused,
    });
    // Somebody else is not affected.
    assert.equal(limits.refusal({ address: address(), client: OTHER }, T0 + MINUTE), null);

    // The early ones lapse together, and the client is back.
    const justBefore = T0 + FAILURE_WINDOW_MS - 1;
    assert.deepEqual(limits.refusal({ address: address(), client: CLIENT }, justBefore), {
      code: "ip_limited",
      retryAfter: 1,
    });
    assert.ok(
      "id" in limits.reserve({ address: address(), client: CLIENT }, T0 + FAILURE_WINDOW_MS),
    );
  });

  it("name the moment the client is back, even when more than the limit were recorded", () => {
    // Attempts already in flight when the limit is reached can still fail.
    const limits = new DripLimits(memorySql());
    for (let i = 0; i < 3; i += 1) limits.fail({ client: CLIENT }, T0);
    for (let i = 0; i < FAILURE_MAX; i += 1) limits.fail({ client: CLIENT }, T0 + MINUTE);

    // When the three early ones lapse there are still ten, so that is not it.
    assert.deepEqual(limits.refusal({ address: address(), client: CLIENT }, T0 + 2 * MINUTE), {
      code: "ip_limited",
      retryAfter: 4 * 60,
    });
    const back = T0 + MINUTE + FAILURE_WINDOW_MS;
    assert.equal(limits.refusal({ address: address(), client: CLIENT }, back - 1).retryAfter, 1);
    assert.equal(limits.refusal({ address: address(), client: CLIENT }, back), null);
  });

  it("do not use up the client's drips", () => {
    const limits = new DripLimits(memorySql());
    for (let i = 1; i < FAILURE_MAX; i += 1) limits.fail({ client: CLIENT }, T0);

    drip(limits, CLIENT, T0, IP_MAX);
  });

  it("are forgotten five minutes on, with or without another request", () => {
    const sql = memorySql();
    const limits = new DripLimits(sql);
    const stored = () => sql.exec("SELECT COUNT(*) AS n FROM failures").one().n;

    limits.fail({ client: CLIENT }, T0);
    limits.fail({ client: OTHER }, T0 + MINUTE);
    assert.equal(limits.prune(T0 + 2 * MINUTE), T0 + FAILURE_WINDOW_MS);
    assert.equal(stored(), 2);

    // The alarm's prune…
    assert.equal(limits.prune(T0 + FAILURE_WINDOW_MS), T0 + MINUTE + FAILURE_WINDOW_MS);
    assert.equal(stored(), 1);
    // …or the next write, whichever comes first.
    limits.fail({ client: CLIENT }, T0 + MINUTE + FAILURE_WINDOW_MS);
    assert.deepEqual(
      sql
        .exec("SELECT client FROM failures")
        .toArray()
        .map((row) => row.client),
      [CLIENT],
    );
  });
});

describe("what is stored", () => {
  it("writes nothing for a refused request", () => {
    const sql = memorySql();
    const limits = new DripLimits(sql);
    drip(limits, CLIENT, T0, IP_MAX);
    const rows = () => [
      sql.exec("SELECT COUNT(*) AS n FROM drips").one().n,
      sql.exec("SELECT COUNT(*) AS n FROM hits").one().n,
    ];
    const stored = rows();

    limits.refusal({ address: address(), client: CLIENT }, T0);
    limits.reserve({ address: address(), client: CLIENT }, T0);
    assert.deepEqual(rows(), stored);
  });

  it("forgets the client after the per-IP window and the drip after the address window", () => {
    const sql = memorySql();
    const limits = new DripLimits(sql);
    const who = address();
    limits.settle(limits.reserve({ address: who, client: CLIENT }, T0).id);

    // Pruning rides on the next reservation, from anyone.
    limits.reserve({ address: address(), client: "198.51.100.7" }, T0 + IP_WINDOW_MS);
    assert.deepEqual(
      sql
        .exec("SELECT client FROM hits")
        .toArray()
        .map((row) => row.client),
      ["198.51.100.7"],
    );
    assert.equal(sql.exec("SELECT COUNT(*) AS n FROM drips WHERE address = ?", who).one().n, 1);

    limits.reserve({ address: address(), client: "198.51.100.7" }, T0 + ADDRESS_WINDOW_MS);
    assert.equal(sql.exec("SELECT COUNT(*) AS n FROM drips WHERE address = ?", who).one().n, 0);
  });

  it("can be pruned without a reservation, and says when the next row is due", () => {
    // What the Durable Object's alarm runs, so nothing waits for the next drip.
    const sql = memorySql();
    const limits = new DripLimits(sql);
    const stored = (table) => sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
    assert.equal(limits.prune(T0), null);

    limits.settle(limits.reserve({ address: address(), client: CLIENT }, T0).id);
    limits.settle(
      limits.reserve({ address: address(), client: "198.51.100.7" }, T0 + 10 * MINUTE).id,
    );

    // Nothing is due yet: the first client key goes in an hour.
    assert.equal(limits.prune(T0 + 20 * MINUTE), T0 + IP_WINDOW_MS);
    assert.equal(stored("hits"), 2);

    assert.equal(limits.prune(T0 + IP_WINDOW_MS), T0 + 10 * MINUTE + IP_WINDOW_MS);
    assert.equal(stored("hits"), 1);

    // Both client keys gone; the drips themselves stay for the address window.
    assert.equal(limits.prune(T0 + 2 * IP_WINDOW_MS), T0 + ADDRESS_WINDOW_MS);
    assert.deepEqual([stored("hits"), stored("drips")], [0, 2]);

    assert.equal(limits.prune(T0 + ADDRESS_WINDOW_MS + 10 * MINUTE), null);
    assert.equal(stored("drips"), 0);
  });
});
