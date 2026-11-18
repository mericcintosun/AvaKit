import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { startWorker } from "./helpers/workerd.mjs";

/**
 * The collector running for real: the Worker and its SQLite-backed Durable
 * Object in local workerd, straight from wrangler.toml. worker.test.mjs covers
 * the behaviour in detail with a clock it controls; this proves the same code
 * holds up in the runtime it ships to. The tests run in order and share state.
 */

const worker = await startWorker({ TELEMETRY_SALT: "test-salt" });
after(() => worker.close());

async function scaffold({ ip = "203.0.113.9", ...fields } = {}) {
  const response = await worker.fetch("/e", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({
      event: "scaffold",
      anonymousId: randomUUID(),
      template: "minimal",
      chain: "fuji",
      pm: "pnpm",
      ok: true,
      cliVersion: "0.2.1",
      platform: "darwin",
      nodeMajor: "24",
      ...fields,
    }),
  });
  await response.arrayBuffer();
  return response.status;
}

async function stats() {
  const response = await worker.fetch("/stats");
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

describe("the collector in workerd", () => {
  let first;

  it("counts scaffolds and only ever reports names it knows", async () => {
    assert.equal(await scaffold({ template: "minimal" }), 202);
    assert.equal(await scaffold({ template: "minimal" }), 202);
    assert.equal(await scaffold({ template: "nft-mint" }), 202);
    assert.equal(await scaffold({ template: "avakit-is-a-scam" }), 202);
    assert.equal(await scaffold({ ok: false, errorKind: "scaffold-failed" }), 202);

    first = await stats();

    assert.equal(first.status, 200);
    const { scaffolds, failures, installs, firstDay, updatedAt } = first.body;
    assert.deepEqual(scaffolds.byTemplate, { minimal: 2, "nft-mint": 1, other: 1 });
    assert.equal(scaffolds.total, 5);
    assert.equal(scaffolds.succeeded, 4);
    assert.equal(scaffolds.last30d, 4);
    assert.deepEqual(scaffolds.byDay, [{ day: firstDay, n: 4 }]);
    assert.deepEqual(failures, { "scaffold-failed": 1 });
    assert.equal(installs, 5);
    assert.match(firstDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Math.abs(Date.now() - Date.parse(updatedAt)) < 60_000);
  });

  it("serves that aggregate for five minutes instead of recomputing it", async () => {
    assert.equal(await scaffold({ template: "token-bridge" }), 202);

    const again = await stats();

    assert.deepEqual(again.body, first.body);
    const maxAge = Number(/^public, max-age=(\d+)$/.exec(again.cacheControl)?.[1]);
    assert.ok(maxAge > 240 && maxAge <= 300, `cache-control was ${again.cacheControl}`);
  });

  it("caps an IPv6 /64 as a single client", async () => {
    const statuses = [];
    for (let host = 1; host <= 61; host += 1) {
      statuses.push(await scaffold({ ip: `2001:db8:1:1::${host.toString(16)}` }));
    }

    assert.deepEqual(statuses, [...Array(60).fill(202), 429]);
    assert.equal(await scaffold({ ip: "2001:db8:1:2::1" }), 202);
  });

  it("answers /health", async () => {
    const response = await worker.fetch("/health");
    assert.deepEqual([response.status, await response.json()], [200, { ok: true }]);
  });
});
