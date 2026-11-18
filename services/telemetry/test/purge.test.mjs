import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { clock, DAY, MINUTE, STATS_TTL, scaffold, stats, T0 } from "./helpers/collector.mjs";
import { loadWorker } from "./helpers/runtime.mjs";

/**
 * POST /admin/purge — the maintainer's way to take a day of test noise back out
 * of the counts. workerd.test.mjs runs the same route in the real runtime.
 */

// Made up for each run, so nothing that looks like a credential is written down.
const TOKEN = randomBytes(32).toString("hex");

/** The day `clock()` starts on, and the one after it. */
const FIRST_DAY = "2026-11-18";
const SECOND_DAY = "2026-11-19";

// The route logs what it removed. That is for `wrangler tail`, not for the test
// output; the test that reads the trail puts its own mock on top of this one.
beforeEach((t) => {
  t.mock.method(console, "log", () => {});
});

/** A collector whose admin route is switched on. */
const withAdmin = (env = {}) =>
  loadWorker({ env: { TELEMETRY_SALT: "test-salt", TELEMETRY_ADMIN_TOKEN: TOKEN, ...env } });

/**
 * POST /admin/purge — with the right token unless `authorization` says
 * otherwise (null: no header). A string `body` is sent exactly as written;
 * anything else is sent as JSON.
 */
async function purge(collector, body, { authorization = `Bearer ${TOKEN}` } = {}) {
  const response = await collector.fetch("/admin/purge", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
}

/** Everything at rest in one of the Durable Object's tables. */
const stored = (collector, table) =>
  collector.counters.sql.exec(`SELECT * FROM ${table} ORDER BY 1, 2, 3`).toArray();

/** Both tables a purge can delete from. */
const atRest = (collector) => ({
  scaffolds: stored(collector, "scaffolds"),
  installs: stored(collector, "installs"),
});

describe("POST /admin/purge", () => {
  it("takes one day out of the counts and leaves the rest", async (t) => {
    const tick = clock(t);
    const collector = await withAdmin();
    await scaffold(collector, { template: "minimal" });
    await scaffold(collector, { template: "nft-mint" });
    const firstDay = stored(collector, "scaffolds");
    tick(DAY);
    await scaffold(collector, { template: "minimal" });
    await scaffold(collector, { template: "minimal" });
    await scaffold(collector, { template: "token-bridge" });
    await scaffold(collector, { ok: false, errorKind: "scaffold-failed" });
    assert.equal((await stats(collector)).scaffolds.total, 6);

    const purged = await purge(collector, { day: SECOND_DAY });

    // Three rows held that day's four events: two successful scaffolds of one
    // template are one row.
    assert.equal(purged.status, 200);
    assert.deepEqual(purged.body, {
      day: SECOND_DAY,
      dryRun: false,
      rows: 3,
      events: 4,
      succeeded: 3,
    });
    // An answer for curl: nothing caches it, no page may read it, and it ends
    // the line it is printed on.
    assert.equal(purged.headers.get("cache-control"), "no-store");
    assert.equal(purged.headers.get("access-control-allow-origin"), null);
    assert.ok(purged.text.endsWith("}\n"));

    // The other day is exactly as it was, at rest and in the aggregate.
    assert.deepEqual(stored(collector, "scaffolds"), firstDay);
    const after = await stats(collector);
    assert.deepEqual(after.scaffolds, {
      total: 2,
      succeeded: 2,
      last30d: 2,
      byTemplate: { minimal: 1, "nft-mint": 1 },
      byDay: [{ day: FIRST_DAY, n: 2 }],
    });
    assert.deepEqual(after.failures, {});
    // Installs are only touched when one is named.
    assert.equal(after.installs, 6);
  });

  it("only reports what it would remove on a dry run", async (t) => {
    const tick = clock(t);
    const collector = await withAdmin();
    const installId = randomUUID();
    await scaffold(collector, { anonymousId: installId });
    await scaffold(collector, { anonymousId: installId, ok: false, errorKind: "dir-exists" });
    const before = atRest(collector);
    const memoised = await stats(collector);

    tick(MINUTE);
    const dry = await purge(collector, { day: FIRST_DAY, installId, dryRun: true });

    assert.equal(dry.status, 200);
    assert.deepEqual(dry.body, {
      day: FIRST_DAY,
      dryRun: true,
      rows: 2,
      events: 2,
      succeeded: 1,
      // First seen that day, so a real run removes it; this one did not.
      install: { found: true, firstDay: FIRST_DAY, removed: false },
    });
    assert.deepEqual(atRest(collector), before);
    // Nothing changed, so the aggregate being served is still good.
    assert.equal((await stats(collector)).updatedAt, memoised.updatedAt);

    // The real call then removes exactly what the dry run said it would.
    const real = await purge(collector, { day: FIRST_DAY, installId, dryRun: false });
    assert.deepEqual(real.body, {
      ...dry.body,
      dryRun: false,
      install: { found: true, firstDay: FIRST_DAY, removed: true },
    });
    assert.deepEqual(atRest(collector), { scaffolds: [], installs: [] });
  });

  it("removes the named install too, but only one first seen that day", async (t) => {
    const tick = clock(t);
    const collector = await withAdmin();
    const regular = randomUUID(); // somebody real: here on the first day, back on the second
    const smokeRun = randomUUID(); // first seen on the day being purged
    await scaffold(collector, { anonymousId: regular });
    tick(DAY);
    await scaffold(collector, { anonymousId: regular });
    await scaffold(collector, { anonymousId: smokeRun });
    await scaffold(collector, { anonymousId: smokeRun });
    const installs = () => stored(collector, "installs").length;

    // An install that was already there the day before is a real one. It stays.
    const kept = await purge(collector, { day: SECOND_DAY, installId: regular });
    assert.deepEqual(kept.body, {
      day: SECOND_DAY,
      dryRun: false,
      rows: 1,
      events: 3,
      succeeded: 3,
      install: { found: true, firstDay: FIRST_DAY, removed: false },
    });
    assert.equal(installs(), 2);

    // The id is hashed with the salt exactly as ingestion hashes it — raw, so
    // the same uuid in another case is another id, there as here.
    const otherCase = await purge(collector, {
      day: SECOND_DAY,
      installId: smokeRun.toUpperCase(),
    });
    assert.deepEqual(otherCase.body.install, { found: false, removed: false });
    assert.equal(installs(), 2);

    const removed = await purge(collector, { day: SECOND_DAY, installId: smokeRun });
    assert.deepEqual(removed.body, {
      day: SECOND_DAY,
      dryRun: false,
      rows: 0,
      events: 0,
      succeeded: 0,
      install: { found: true, firstDay: SECOND_DAY, removed: true },
    });
    assert.equal(installs(), 1);

    const again = await purge(collector, { day: SECOND_DAY, installId: smokeRun });
    assert.deepEqual(again.body.install, { found: false, removed: false });

    const after = await stats(collector);
    assert.equal(after.installs, 1);
    assert.equal(after.firstDay, FIRST_DAY);
    assert.equal(after.scaffolds.total, 1);
  });

  it("deletes the day and the install together or not at all", async (t) => {
    clock(t);
    t.mock.method(console, "error", () => {});
    const collector = await withAdmin();
    const installId = randomUUID();
    await scaffold(collector, { anonymousId: installId });
    const before = atRest(collector);

    // The day's scaffolds are deleted first; then deleting the install fails.
    collector.counters.sql.failOn = (query) => query.startsWith("DELETE FROM installs");
    const failed = await purge(collector, { day: FIRST_DAY, installId });
    collector.counters.sql.failOn = null;

    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, {
      error: "Purge failed. Run it again with dryRun to see what is stored.",
    });
    assert.deepEqual(atRest(collector), before);
  });

  it("shows in /stats at once where it ran, and within five minutes everywhere else", async (t) => {
    const tick = clock(t);
    const collector = await withAdmin();
    const elsewhere = await loadWorker({ env: collector.env });
    await scaffold(collector);
    await scaffold(collector);
    // Both isolates, and the Durable Object, now hold the aggregate.
    assert.equal((await stats(collector)).scaffolds.total, 2);
    assert.equal((await stats(elsewhere)).scaffolds.total, 2);

    tick(MINUTE);
    await purge(collector, { day: FIRST_DAY });

    const here = await stats(collector);
    assert.equal(here.scaffolds.total, 0);
    assert.equal(here.updatedAt, new Date(T0 + MINUTE).toISOString());

    // Another isolate cannot be told; its copy runs out on schedule.
    assert.equal((await stats(elsewhere)).scaffolds.total, 2);
    tick(STATS_TTL - MINUTE);
    assert.equal((await stats(elsewhere)).scaffolds.total, 0);
  });

  it("leaves a trail of what it removed, without the token or the install id", async (t) => {
    clock(t);
    const log = t.mock.method(console, "log", () => {});
    const collector = await withAdmin();
    const installId = randomUUID();
    await scaffold(collector, { anonymousId: installId });

    await purge(collector, { day: FIRST_DAY, installId, dryRun: true });
    await purge(collector, { day: FIRST_DAY, installId });

    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [
        {
          message: "purge dry run",
          day: FIRST_DAY,
          rows: 1,
          events: 1,
          succeeded: 1,
          install: { found: true, firstDay: FIRST_DAY, removed: false },
        },
        {
          message: "purged a day",
          day: FIRST_DAY,
          rows: 1,
          events: 1,
          succeeded: 1,
          install: { found: true, firstDay: FIRST_DAY, removed: true },
        },
      ],
    );
    assert.ok(!lines.join("\n").includes(TOKEN));
    assert.ok(!lines.join("\n").includes(installId));
  });
});

describe("who may call /admin/purge", () => {
  it("does not exist until TELEMETRY_ADMIN_TOKEN is set", async (t) => {
    clock(t);
    for (const env of [{}, { TELEMETRY_ADMIN_TOKEN: "" }]) {
      const collector = await loadWorker({ env: { TELEMETRY_SALT: "test-salt", ...env } });
      await scaffold(collector);

      const unknownPath = await collector.fetch("/nope", { method: "POST" });
      const refused = await collector.fetch("/admin/purge", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ day: FIRST_DAY }),
      });

      // Exactly what any unknown path answers, headers included.
      assert.equal(refused.status, 404);
      assert.deepEqual(await refused.json(), { error: "Not found." });
      assert.deepEqual([...refused.headers], [...unknownPath.headers]);
      assert.equal(collector.counters.calls.purge, 0);
      assert.equal(stored(collector, "scaffolds").length, 1);
    }
  });

  it("stays off, and says why, while the token is too short to be a secret", async (t) => {
    clock(t);
    const tooShort = [500, { error: "TELEMETRY_ADMIN_TOKEN must be at least 32 characters." }];

    // Even the right token opens nothing, and nobody is told what it is.
    const guessable = await withAdmin({ TELEMETRY_ADMIN_TOKEN: "hunter2" });
    await scaffold(guessable);
    const refused = await purge(guessable, { day: FIRST_DAY }, { authorization: "Bearer hunter2" });
    assert.deepEqual([refused.status, refused.body], tooShort);
    const anonymous = await purge(guessable, { day: FIRST_DAY }, { authorization: null });
    assert.deepEqual([anonymous.status, anonymous.body], tooShort);
    assert.equal(guessable.counters.calls.purge, 0);
    assert.equal(stored(guessable, "scaffolds").length, 1);

    // 31 characters is still off; 32 is on.
    const short = "s".repeat(31);
    const off = await withAdmin({ TELEMETRY_ADMIN_TOKEN: short });
    const stillOff = await purge(off, { day: FIRST_DAY }, { authorization: `Bearer ${short}` });
    assert.deepEqual([stillOff.status, stillOff.body], tooShort);

    const enough = "s".repeat(32);
    const on = await withAdmin({ TELEMETRY_ADMIN_TOKEN: enough });
    const answered = await purge(on, { day: FIRST_DAY }, { authorization: `Bearer ${enough}` });
    assert.equal(answered.status, 200);
  });

  it("turns away a missing or wrong token, comparing in constant time", async (t) => {
    clock(t);
    const collector = await withAdmin();
    await scaffold(collector);
    const compare = t.mock.method(crypto.subtle, "timingSafeEqual");

    const attempts = [
      null, // no Authorization header at all
      "Bearer",
      "Bearer wrong",
      `Bearer ${TOKEN.slice(0, -1)}`,
      `Bearer ${TOKEN}0`,
      `Bearer ${TOKEN} and-more`,
      `Basic ${TOKEN}`,
      TOKEN,
    ];
    for (const authorization of attempts) {
      const refused = await purge(collector, { day: FIRST_DAY }, { authorization });
      assert.equal(refused.status, 401, String(authorization));
      assert.deepEqual(refused.body, { error: "Unauthorized." });
      assert.equal(refused.headers.get("www-authenticate"), "Bearer");
      assert.equal(refused.headers.get("cache-control"), "no-store");
    }

    // Every guess was hashed and then compared as 32 bytes against 32 bytes by
    // the runtime's constant-time primitive, so neither its length nor where it
    // goes wrong changes how long the answer takes.
    assert.equal(compare.mock.callCount(), attempts.length);
    for (const call of compare.mock.calls) {
      assert.deepEqual(
        call.arguments.map((buffer) => buffer.byteLength),
        [32, 32],
      );
      assert.equal(call.result, false);
    }
    assert.equal(collector.counters.calls.purge, 0);
    assert.equal(stored(collector, "scaffolds").length, 1);
  });

  it("accepts the right token whatever the case of the scheme, and only by POST", async (t) => {
    clock(t);
    const collector = await withAdmin();

    for (const authorization of [`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `BEARER  ${TOKEN}`]) {
      assert.equal((await purge(collector, { day: FIRST_DAY }, { authorization })).status, 200);
    }

    const get = await collector.fetch("/admin/purge", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.deepEqual([get.status, await get.json()], [404, { error: "Not found." }]);
  });
});

describe("what /admin/purge accepts", () => {
  it("refuses a request it does not fully understand, deleting nothing", async (t) => {
    clock(t);
    const collector = await withAdmin();
    await scaffold(collector);

    const day = "day must be a date written YYYY-MM-DD.";
    const requests = [
      // Strings go out as written: no body, a broken one, and JSON that is
      // well-formed but not an object.
      ["", "Invalid JSON body."],
      ["{not json", "Invalid JSON body."],
      ["null", "Expected a JSON object."],
      ["42", "Expected a JSON object."],
      [`"${FIRST_DAY}"`, "Expected a JSON object."],
      [[{ day: FIRST_DAY }], "Expected a JSON object."],
      [{}, day],
      [{ day: 20261118 }, day],
      [{ day: "18-11-2026" }, day],
      [{ day: "2026-13-01" }, day],
      [{ day: "2026-02-31" }, day],
      [{ day: `${FIRST_DAY}T09:00:00Z` }, day],
      [{ day: [FIRST_DAY] }, day],
      [{ day: FIRST_DAY, installId: "not-a-uuid" }, "installId must be a uuid."],
      [{ day: FIRST_DAY, installId: null }, "installId must be a uuid."],
      [{ day: FIRST_DAY, installId: [randomUUID()] }, "installId must be a uuid."],
      // The ones that matter most: a dry run that was mistyped must not delete.
      [{ day: FIRST_DAY, dryRun: "true" }, "dryRun must be true or false."],
      [{ day: FIRST_DAY, dryRun: 1 }, "dryRun must be true or false."],
      [{ day: FIRST_DAY, dryRun: null }, "dryRun must be true or false."],
      [{ day: FIRST_DAY, dry_run: true }, 'Unknown field "dry_run".'],
      [{ day: FIRST_DAY, dryrun: true }, 'Unknown field "dryrun".'],
      [{ day: FIRST_DAY, days: [FIRST_DAY] }, 'Unknown field "days".'],
    ];
    for (const [body, error] of requests) {
      const refused = await purge(collector, body);
      assert.deepEqual([refused.status, refused.body], [400, { error }], JSON.stringify(body));
    }

    assert.equal(collector.counters.calls.purge, 0);
    assert.equal(stored(collector, "scaffolds").length, 1);
  });

  it("needs the salt to look an install up, and for nothing else", async (t) => {
    clock(t);
    const collector = await withAdmin({ TELEMETRY_SALT: "" });

    const plain = await purge(collector, { day: FIRST_DAY });
    assert.deepEqual(plain.body, {
      day: FIRST_DAY,
      dryRun: false,
      rows: 0,
      events: 0,
      succeeded: 0,
    });

    const named = await purge(collector, { day: FIRST_DAY, installId: randomUUID() });
    assert.deepEqual([named.status, named.body], [500, { error: "Collector not configured." }]);
    assert.equal(collector.counters.calls.purge, 1);
  });
});
