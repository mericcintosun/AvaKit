import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { TEMPLATES } from "../src/templates.js";
import { clock, MINUTE, SECOND, STATS_TTL, scaffold, stats, T0 } from "./helpers/collector.mjs";
import { loadWorker } from "./helpers/runtime.mjs";

const sum = (counts) => Object.values(counts).reduce((total, n) => total + n, 0);

describe("POST /e", () => {
  it("counts a scaffold", async (t) => {
    clock(t);
    const collector = await loadWorker();

    assert.equal((await scaffold(collector, { template: "nft-mint" })).status, 202);
    assert.equal((await scaffold(collector, { ok: false, errorKind: "dir-exists" })).status, 202);

    const { cacheControl, ...body } = await stats(collector);
    assert.deepEqual(body, {
      scaffolds: {
        total: 2,
        succeeded: 1,
        last30d: 1,
        byTemplate: { "nft-mint": 1 },
        byDay: [{ day: "2026-11-18", n: 1 }],
      },
      failures: { "dir-exists": 1 },
      installs: 2,
      firstDay: "2026-11-18",
      updatedAt: new Date(T0).toISOString(),
    });
    assert.equal(cacheControl, "public, max-age=300");
  });

  it("keeps every template the CLI ships under its own name", async (t) => {
    clock(t);
    const collector = await loadWorker();
    for (const template of TEMPLATES) await scaffold(collector, { template });

    const { scaffolds } = await stats(collector);
    assert.deepEqual(scaffolds.byTemplate, Object.fromEntries(TEMPLATES.map((id) => [id, 1])));
  });

  it("files anything that is not one of those templates under other", async (t) => {
    // `template` used to be any 32-character slug, so a single request could
    // put a label of the sender's choosing on the public stats page.
    clock(t);
    const collector = await loadWorker();
    const invented = [
      "avakit-is-a-scam",
      "buy-my-token",
      "minimal-2",
      "Minimal",
      " minimal",
      "minimal\n",
      "",
      42,
      null,
      ["minimal"],
      { toString: "minimal" },
    ];
    for (const template of invented) {
      assert.equal((await scaffold(collector, { template })).status, 202);
    }
    await scaffold(collector, { template: "minimal" });

    const { scaffolds } = await stats(collector);
    assert.deepEqual(scaffolds.byTemplate, { other: invented.length, minimal: 1 });
    assert.equal(sum(scaffolds.byTemplate), scaffolds.succeeded);
  });

  it("refuses what is not a scaffold event", async (t) => {
    clock(t);
    const collector = await loadWorker();
    const post = (body) => collector.fetch("/e", { method: "POST", body });

    const responses = await Promise.all([
      post("{not json"),
      post(JSON.stringify({ event: "pageview", anonymousId: randomUUID() })),
      post(JSON.stringify({ event: "scaffold", anonymousId: "not-a-uuid" })),
      post(JSON.stringify(null)),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status),
      [400, 400, 400, 400],
    );
    assert.equal((await stats(collector)).scaffolds.total, 0);
  });

  it("says so when the salt is missing", async () => {
    const collector = await loadWorker({ env: { TELEMETRY_SALT: "" } });
    const response = await scaffold(collector);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Collector not configured." });
  });
});

describe("GET /stats", () => {
  it("folds labels stored before the allowlist into other", async (t) => {
    clock(t);
    const collector = await loadWorker();
    await scaffold(collector, { template: "minimal" });
    await scaffold(collector, { template: "something-new" });

    // Rows the old, pattern-based check let through are already at rest.
    const legacy = (template, ok, n) =>
      collector.counters.sql.exec(
        `INSERT INTO scaffolds (day, template, wallet, chain, pm, cli, platform, ok, error_kind, n)
         VALUES ('2026-11-01', ?, 'other', 'fuji', 'pnpm', '0.2.0', 'linux', ?, ?, ?)`,
        template,
        ok,
        ok ? "none" : "scaffold-failed",
        n,
      );
    legacy("avakit-is-a-scam", 1, 40);
    legacy("free-airdrop", 1, 2);
    legacy("nft-mint", 1, 3);
    legacy("avakit-is-a-scam", 0, 5);

    const { scaffolds } = await stats(collector);
    assert.deepEqual(scaffolds.byTemplate, { other: 43, "nft-mint": 3, minimal: 1 });
    assert.equal(scaffolds.succeeded, 47);
    assert.equal(scaffolds.total, 52);
    assert.equal(sum(scaffolds.byTemplate), scaffolds.succeeded);
  });

  it("is computed once per five minutes, however often it is asked for", async (t) => {
    // A cache-control header alone does not make Cloudflare cache a response a
    // Worker generated: every request used to run the aggregate queries.
    const tick = clock(t);
    const collector = await loadWorker();
    await scaffold(collector);

    const first = await stats(collector);
    const { executed } = collector.counters.sql;

    // An isolate somewhere else: nothing of its own to serve, but the same
    // Durable Object, which answers from memory.
    tick(2 * MINUTE);
    const elsewhere = await loadWorker({ env: collector.env });
    const second = await stats(elsewhere);

    assert.equal(collector.counters.sql.executed, executed, "no SQL ran for the second isolate");
    assert.deepEqual({ ...second, cacheControl: null }, { ...first, cacheControl: null });
    assert.equal(second.cacheControl, "public, max-age=180");
  });

  it("costs one call to the Durable Object per isolate per window", async (t) => {
    const tick = clock(t);
    const collector = await loadWorker();

    for (let i = 0; i < 25; i += 1) await stats(collector);
    assert.equal(collector.counters.calls.stats, 1);

    tick(STATS_TTL - 1);
    await stats(collector);
    assert.equal(collector.counters.calls.stats, 1);

    tick(1);
    await stats(collector);
    assert.equal(collector.counters.calls.stats, 2);
  });

  it("shows a new scaffold once the window has passed, and says when it was read", async (t) => {
    const tick = clock(t);
    const collector = await loadWorker();
    await scaffold(collector);
    const before = await stats(collector);

    tick(MINUTE);
    await scaffold(collector);
    const during = await stats(collector);
    assert.equal(during.scaffolds.succeeded, 1);
    assert.equal(during.updatedAt, before.updatedAt);

    tick(STATS_TTL - MINUTE);
    const after = await stats(collector);
    assert.equal(after.scaffolds.succeeded, 2);
    assert.equal(after.updatedAt, new Date(T0 + STATS_TTL).toISOString());
  });

  it("tells caches to keep it only for as long as it will itself", async (t) => {
    const tick = clock(t);
    const collector = await loadWorker();

    assert.equal((await stats(collector)).cacheControl, "public, max-age=300");
    tick(100 * SECOND);
    assert.equal((await stats(collector)).cacheControl, "public, max-age=200");
    tick(199 * SECOND + 500);
    assert.equal((await stats(collector)).cacheControl, "public, max-age=1");
    tick(500);
    assert.equal((await stats(collector)).cacheControl, "public, max-age=300");
  });

  it("recomputes after the Durable Object has been evicted", async (t) => {
    // The memo lives in memory only; losing it costs one recompute, nothing else.
    const tick = clock(t);
    const collector = await loadWorker();
    await scaffold(collector);
    await stats(collector);

    await scaffold(collector);
    collector.counters.evict();
    tick(MINUTE);
    const elsewhere = await loadWorker({ env: collector.env });

    assert.equal((await stats(elsewhere)).scaffolds.succeeded, 2);
  });

  it("stamps and expires the aggregate itself when the object's answer has no date", async (t) => {
    // Mid-deploy, a Worker on this code can reach a Durable Object still on the
    // previous code, whose stats() carried no `updatedAt`. The stats page
    // parses that field, so it must be there, and the copy must still lapse.
    const tick = clock(t);
    const previous = {
      calls: 0,
      idFromName: (name) => name,
      get: () => ({
        async stats() {
          previous.calls += 1;
          return {
            scaffolds: { total: 0, succeeded: 0, last30d: 0, byTemplate: {}, byDay: [] },
            failures: {},
            installs: 0,
            firstDay: null,
          };
        },
      }),
    };
    const collector = await loadWorker({
      env: { TELEMETRY_SALT: "test-salt", COUNTERS: previous },
    });

    const first = await stats(collector);
    assert.equal(first.updatedAt, new Date(T0).toISOString());
    assert.equal(first.cacheControl, "public, max-age=300");

    tick(STATS_TTL - 1);
    await stats(collector);
    assert.equal(previous.calls, 1);
    tick(1);
    assert.equal((await stats(collector)).updatedAt, new Date(T0 + STATS_TTL).toISOString());
    assert.equal(previous.calls, 2);
  });
});

describe("the daily cap", () => {
  it("counts 60 events from one client and drops the rest", async (t) => {
    clock(t);
    const collector = await loadWorker();

    for (let i = 0; i < 60; i += 1) assert.equal((await scaffold(collector)).status, 202);
    assert.equal((await scaffold(collector)).status, 429);
    assert.equal((await scaffold(collector, { ip: "198.51.100.7" })).status, 202);

    const { scaffolds, installs } = await stats(collector);
    assert.equal(scaffolds.total, 61);
    assert.equal(installs, 61);
  });

  it("treats an IPv6 /64 as one client", async (t) => {
    // Whoever holds one address in a /64 holds all 2^64 of them: capped per
    // address, the same machine got a fresh 60 with every new suffix.
    clock(t);
    const collector = await loadWorker();

    for (let host = 1; host <= 60; host += 1) {
      const ip = `2001:db8:1:1::${host.toString(16)}`;
      assert.equal((await scaffold(collector, { ip })).status, 202);
    }
    assert.equal(
      (await scaffold(collector, { ip: "2001:db8:1:1:aaaa:bbbb:cccc:dddd" })).status,
      429,
    );
    assert.equal((await scaffold(collector, { ip: "2001:db8:1:2::1" })).status, 202);
  });

  it("starts over the next day", async (t) => {
    const tick = clock(t);
    const collector = await loadWorker();
    for (let i = 0; i < 60; i += 1) await scaffold(collector);
    assert.equal((await scaffold(collector)).status, 429);

    tick(24 * 60 * MINUTE);
    assert.equal((await scaffold(collector)).status, 202);
  });
});

describe("what is stored", () => {
  it("holds neither the address nor the id it was sent", async (t) => {
    clock(t);
    const collector = await loadWorker();
    const anonymousId = randomUUID();
    await scaffold(collector, { ip: "203.0.113.77", anonymousId });
    await scaffold(collector, { ip: "2001:db8:7:7::77", anonymousId });

    const { sql } = collector.counters;
    const atRest = JSON.stringify(
      ["scaffolds", "installs", "rate"].map((table) =>
        sql.exec(`SELECT * FROM ${table}`).toArray(),
      ),
    );
    assert.doesNotMatch(atRest, /203\.0\.113|2001:db8/);
    assert.ok(!atRest.includes(anonymousId));
    assert.equal(sql.exec("SELECT COUNT(*) AS n FROM installs").one().n, 1);
    assert.equal(sql.exec("SELECT COUNT(*) AS n FROM rate").one().n, 2);
  });

  it("fills the vestigial wallet column with other for every current CLI", async (t) => {
    // create-avalanche-app stopped reporting `wallet` in 0.4.0. The column is
    // part of the primary key, so it stays; only an older CLI still fills it.
    clock(t);
    const collector = await loadWorker();
    await scaffold(collector, { cliVersion: "0.4.1" });
    await scaffold(collector, { cliVersion: "0.3.1", wallet: "injected" });

    const rows = collector.counters.sql
      .exec("SELECT cli, wallet, n FROM scaffolds ORDER BY cli")
      .toArray()
      .map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { cli: "0.3.1", wallet: "injected", n: 1 },
      { cli: "0.4.1", wallet: "other", n: 1 },
    ]);
    // Nothing reads the column: both are simply two scaffolds.
    assert.equal((await stats(collector)).scaffolds.succeeded, 2);
  });
});

describe("everything else", () => {
  it("answers /health, a preflight and an unknown path", async () => {
    const collector = await loadWorker();

    const health = await collector.fetch("/health");
    assert.deepEqual([health.status, await health.json()], [200, { ok: true }]);

    const preflight = await collector.fetch("/e", { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

    const missing = await collector.fetch("/nope");
    assert.deepEqual([missing.status, await missing.json()], [404, { error: "Not found." }]);
  });
});
