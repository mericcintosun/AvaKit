import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { startWorker } from "./helpers/workerd.mjs";

/**
 * The collector running for real: the Worker and its SQLite-backed Durable
 * Object in local workerd, straight from wrangler.toml. worker.test.mjs and
 * purge.test.mjs cover the behaviour in detail with a clock they control; this
 * proves the same code holds up in the runtime it ships to. The tests run in
 * order and share state.
 */

const SALT = { TELEMETRY_SALT: "test-salt" };

const worker = await startWorker(SALT);
after(() => worker.close());

/** What the collector has accepted so far: every event, and the successful ones. */
const accepted = { events: 0, succeeded: 0 };

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
  if (response.status === 202) {
    accepted.events += 1;
    if (fields.ok !== false) accepted.succeeded += 1;
  }
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

/** POST /admin/purge, with `token` as the bearer token. */
async function purge(body, token) {
  const response = await worker.fetch("/admin/purge", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
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

describe("/admin/purge in workerd", () => {
  // Made up for each run, so nothing that looks like a credential is written down.
  const TOKEN = randomBytes(32).toString("hex");
  /** The install whose row goes with the day. */
  const installId = randomUUID();
  let day;
  let dry;

  it("does not exist until TELEMETRY_ADMIN_TOKEN is set", async () => {
    const refused = await purge({ day: "2026-11-18", dryRun: true }, TOKEN);
    assert.deepEqual([refused.status, refused.body], [404, { error: "Not found." }]);
  });

  it("opens for that token and nobody else, and a dry run deletes nothing", async () => {
    // Setting the secret is all it takes; what was counted so far is kept.
    await worker.configure({ ...SALT, TELEMETRY_ADMIN_TOKEN: TOKEN });
    assert.equal(await scaffold({ anonymousId: installId }), 202);
    // Everything in this file was counted on one day; ask the collector which.
    day = (await stats()).body.firstDay;

    const guess = await purge({ day }, randomBytes(32).toString("hex"));
    assert.deepEqual([guess.status, guess.body], [401, { error: "Unauthorized." }]);

    dry = await purge({ day, installId, dryRun: true }, TOKEN);
    assert.equal(dry.status, 200);
    assert.ok(dry.body.rows > 1, `only ${dry.body.rows} row(s) for ${accepted.events} events`);
    assert.deepEqual(dry.body, {
      day,
      dryRun: true,
      rows: dry.body.rows,
      events: accepted.events,
      succeeded: accepted.succeeded,
      install: { found: true, firstDay: day, removed: false },
    });
    // Neither the wrong token nor the dry run removed anything.
    assert.deepEqual((await purge({ day, installId, dryRun: true }, TOKEN)).body, dry.body);
  });

  it("removes the day and the install, and /stats shows it at once", async () => {
    // The Durable Object and this isolate are both serving a memoised aggregate
    // that still has the day in it.
    const before = await stats();
    assert.ok(before.body.scaffolds.total > 0);
    assert.match(before.cacheControl, /^public, max-age=\d+$/);

    // Exactly what the dry run said, and this time the install went too.
    const purged = await purge({ day, installId }, TOKEN);
    assert.equal(purged.status, 200);
    assert.deepEqual(purged.body, {
      ...dry.body,
      dryRun: false,
      install: { found: true, firstDay: day, removed: true },
    });

    const afterwards = await stats();
    assert.deepEqual(afterwards.body.scaffolds, {
      total: 0,
      succeeded: 0,
      last30d: 0,
      byTemplate: {},
      byDay: [],
    });
    assert.deepEqual(afterwards.body.failures, {});
    // Every event came from an install of its own, and only the named one went.
    assert.equal(afterwards.body.installs, accepted.events - 1);

    // Nothing of the day or of that install is left to remove.
    const again = await purge({ day, installId, dryRun: true }, TOKEN);
    assert.deepEqual(again.body, {
      day,
      dryRun: true,
      rows: 0,
      events: 0,
      succeeded: 0,
      install: { found: false, removed: false },
    });
    const unnamed = await purge({ day }, TOKEN);
    assert.deepEqual(unnamed.body, { day, dryRun: false, rows: 0, events: 0, succeeded: 0 });
  });
});
