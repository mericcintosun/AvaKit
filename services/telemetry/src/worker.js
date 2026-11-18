import { DurableObject } from "cloudflare:workers";
import { clientKey } from "./ip.js";
import { TEMPLATES } from "./templates.js";

/**
 * AvaKit telemetry collector — a Cloudflare Worker that counts anonymous
 * `create-avalanche-app` scaffolds and serves the aggregate that powers
 * avakit.dev/stats.
 *
 *   POST /e      { event: "scaffold", anonymousId, template, … } → 202
 *   GET  /stats                                                  → the aggregate
 *   GET  /health                                                 → { ok }
 *
 * Counting lives in a single SQLite-backed Durable Object rather than in KV. KV
 * would need a read-modify-write per counter, which both races (concurrent
 * scaffolds silently lose counts) and hits KV's hard ceiling of one write per
 * second per key — on a number we intend to publish, neither is acceptable. The
 * DO serialises writes and is transactional, and its free tier is 100k rows/day
 * against KV's 1k writes/day.
 *
 * Privacy is the product here, so the rules are strict:
 *  - No IP is ever stored. Rate limiting keys off a SHA-256 of (client + secret
 *    salt + today), which is discarded the next day and can't be walked back to
 *    an IP without the salt. The client is an IPv4 address or an IPv6 /64.
 *  - `anonymousId` is a random uuid the CLI generated; we store only a salted
 *    hash of it, so even the raw id never lands at rest.
 *  - Everything else is a bounded enum (template, wallet, chain, pm, platform).
 *
 * Honesty note: this is self-reported by a client we don't control, so the
 * number is a floor with a spoofable ceiling. `/stats` says so, and the npm
 * download count next to it is the independent cross-check.
 */

/** Per-client daily cap. A human doesn't scaffold 60 apps a day; a loop does. */
const IP_DAILY_MAX = 60;

/**
 * How long one computed aggregate is served for. The page is a slow-moving
 * vanity number, and this keeps a hug-of-death off the Durable Object.
 */
const STATS_TTL_MS = 5 * 60 * 1000;

/**
 * Bounds on what a client may report. Anything failing these becomes "other"
 * rather than being rejected — a new template shipping shouldn't stop counting,
 * but an attacker shouldn't be able to invent rows, or labels, either. The
 * per-client cap is what actually bounds cardinality; these keep the data
 * readable and, for `template`, keep it to names we chose (see templates.js).
 */
const SHAPES = {
  template: new RegExp(`^(${TEMPLATES.join("|")})$`),
  wallet: /^(web3auth|injected|burner|coinbase)$/,
  chain: /^(fuji|c-chain)$/,
  pm: /^(pnpm|npm|yarn|bun)$/,
  platform: /^(darwin|linux|win32|freebsd|openbsd)$/,
  cliVersion: /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[a-z0-9.]{1,16})?$/,
  nodeMajor: /^\d{1,3}$/,
  errorKind: /^(dir-exists|scaffold-failed)$/,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only values we recognise; everything else collapses to "other". */
function clean(value, shape) {
  return typeof value === "string" && shape.test(value) ? value : "other";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function saltedHash(value, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// ── The counter store ───────────────────────────────────────────────────────

export class Counters extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    /** The last aggregate and when it stops being served — see stats(). */
    this.cached = null;

    // Aggregate rows, not an event log: one row per distinct combination per
    // day, incremented in place. Bounded, and there's nothing per-person in it.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS scaffolds (
        day TEXT NOT NULL,
        template TEXT NOT NULL,
        wallet TEXT NOT NULL,
        chain TEXT NOT NULL,
        pm TEXT NOT NULL,
        cli TEXT NOT NULL,
        platform TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error_kind TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, template, wallet, chain, pm, cli, platform, ok, error_kind)
      )
    `);

    // One row per install, keyed by a salted hash of the CLI's random id. This
    // is what separates "ten people tried it" from "one person ran it ten times"
    // — the single number a grant committee actually asks about.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS installs (
        id TEXT PRIMARY KEY,
        first_day TEXT NOT NULL,
        last_day TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Abuse counters. Rows are pruned the next day, so this holds at most one
    // day of salted hashes and never an address.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate (
        bucket TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  /** @returns true if counted, false if the caller is over its daily cap. */
  record(event, ipHash, idHash) {
    const day = today();

    this.sql.exec("DELETE FROM rate WHERE day != ?", day);
    const bucket = this.sql
      .exec(
        `INSERT INTO rate (bucket, day, n) VALUES (?, ?, 1)
         ON CONFLICT (bucket) DO UPDATE SET n = n + 1
         RETURNING n`,
        ipHash,
        day,
      )
      .one();
    if (bucket.n > IP_DAILY_MAX) return false;

    this.sql.exec(
      `INSERT INTO scaffolds (day, template, wallet, chain, pm, cli, platform, ok, error_kind, n)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT DO UPDATE SET n = n + 1`,
      day,
      event.template,
      event.wallet,
      event.chain,
      event.pm,
      event.cliVersion,
      event.platform,
      event.ok ? 1 : 0,
      event.errorKind,
    );

    this.sql.exec(
      `INSERT INTO installs (id, first_day, last_day, n) VALUES (?, ?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET n = n + 1, last_day = excluded.last_day`,
      idHash,
      day,
      day,
    );

    return true;
  }

  /**
   * The public aggregate, computed at most once per STATS_TTL_MS.
   *
   * `/stats` is unauthenticated and a `cache-control` header does not make
   * Cloudflare cache a response a Worker generated, so without this every
   * request would run the queries below in the one object that also has to
   * count scaffolds. `updatedAt` is when the numbers were read, and callers use
   * it to know how long their copy is good for.
   */
  stats() {
    const now = Date.now();
    if (!this.cached || now >= this.cached.until) {
      this.cached = {
        until: now + STATS_TTL_MS,
        value: { ...this.#aggregate(), updatedAt: new Date(now).toISOString() },
      };
    }
    return this.cached.value;
  }

  #aggregate() {
    const totals = this.sql
      .exec(
        `SELECT COALESCE(SUM(n), 0) AS all_n,
                COALESCE(SUM(CASE WHEN ok = 1 THEN n ELSE 0 END), 0) AS ok_n
         FROM scaffolds`,
      )
      .one();

    const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);

    // `total` counts every attempt; everything else counts successes only, so the
    // breakdowns reconcile against each other on the page rather than looking
    // like an off-by-some bug (sum(byTemplate) === succeeded, sum(byDay) ===
    // last30d). Failures stay visible as `total - succeeded`.
    return {
      scaffolds: {
        total: Number(totals.all_n),
        succeeded: Number(totals.ok_n),
        last30d: Number(
          this.sql
            .exec("SELECT COALESCE(SUM(n), 0) AS n FROM scaffolds WHERE ok = 1 AND day >= ?", since)
            .one().n,
        ),
        // Only names we chose ever leave here. `template` is validated on the
        // way in, but rows written before it was an exact list may hold any
        // slug a caller cared to send, so those are folded into "other" too.
        byTemplate: Object.fromEntries(
          this.sql
            .exec(
              `SELECT CASE WHEN template IN (${TEMPLATES.map(() => "?").join(", ")})
                           THEN template ELSE 'other' END AS label,
                      SUM(n) AS n
               FROM scaffolds WHERE ok = 1
               GROUP BY label ORDER BY n DESC`,
              ...TEMPLATES,
            )
            .toArray()
            .map((r) => [r.label, Number(r.n)]),
        ),
        byDay: this.sql
          .exec(
            `SELECT day, SUM(n) AS n FROM scaffolds WHERE ok = 1 AND day >= ?
             GROUP BY day ORDER BY day ASC`,
            since,
          )
          .toArray()
          .map((r) => ({ day: r.day, n: Number(r.n) })),
      },
      // Which way a scaffold failed — the one number that tells our bug
      // (scaffold-failed) apart from a user typing a name they already used
      // (dir-exists). Not on the public page; it's for us.
      failures: Object.fromEntries(
        this.sql
          .exec(
            `SELECT error_kind, SUM(n) AS n FROM scaffolds WHERE ok = 0
             GROUP BY error_kind ORDER BY n DESC`,
          )
          .toArray()
          .map((r) => [r.error_kind, Number(r.n)]),
      ),
      installs: Number(this.sql.exec("SELECT COUNT(*) AS n FROM installs").one().n),
      firstDay: this.sql.exec("SELECT MIN(first_day) AS d FROM installs").one().d,
    };
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-max-age": "86400",
};

/** A JSON response from text that is already serialised. */
function jsonText(text, status, cache) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS,
      ...(cache ? { "cache-control": cache } : {}),
    },
  });
}

function json(body, status, cache) {
  return jsonText(JSON.stringify(body), status, cache);
}

/**
 * Preflight. MUST be a null body: constructing a Response with a body and a 204
 * throws, which takes the Worker down and leaves the browser with no CORS
 * headers at all. (We learned this the hard way on the faucet.)
 */
function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function counters(env) {
  return env.COUNTERS.get(env.COUNTERS.idFromName("global"));
}

/**
 * This isolate's copy of the aggregate. The Durable Object already memoises
 * it, so asking again costs no SQL — but it is still a round trip to a single
 * object somewhere else in the world, and a loop against `/stats` should not
 * be able to buy one per request. The copy is public data, never per-request
 * state; it is kept as text, so it holds on to nothing from the request that
 * fetched it, and is dropped at the moment the object's own copy expires.
 */
let statsCopy = null;

async function publicStats(env, now) {
  if (!statsCopy || now >= statsCopy.until) {
    const stats = await counters(env).stats();
    statsCopy = {
      text: JSON.stringify(stats),
      until: Date.parse(stats.updatedAt) + STATS_TTL_MS,
    };
  }
  return statsCopy;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return preflight();

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, 200);
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const now = Date.now();
      const { text, until } = await publicStats(env, now);
      // Browsers and other caches may keep it exactly as long as we will.
      const maxAge = Math.max(0, Math.ceil((until - now) / 1000));
      return jsonText(text, 200, `public, max-age=${maxAge}`);
    }

    if (request.method === "POST" && url.pathname === "/e") {
      if (!env.TELEMETRY_SALT) return json({ error: "Collector not configured." }, 500);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      if (body?.event !== "scaffold" || !UUID.test(String(body.anonymousId ?? ""))) {
        return json({ error: "Unrecognised event." }, 400);
      }

      const event = {
        template: clean(body.template, SHAPES.template),
        wallet: clean(body.wallet, SHAPES.wallet),
        chain: clean(body.chain, SHAPES.chain),
        pm: clean(body.pm, SHAPES.pm),
        cliVersion: clean(body.cliVersion, SHAPES.cliVersion),
        platform: clean(body.platform, SHAPES.platform),
        ok: body.ok === true,
        // "none" rather than null so it can sit in the primary key.
        errorKind: body.ok === true ? "none" : clean(body.errorKind, SHAPES.errorKind),
      };

      const salt = env.TELEMETRY_SALT;
      // An IPv6 client is capped per /64 — it owns all of it, so a cap per
      // address would be no cap at all.
      const client = clientKey(request.headers.get("cf-connecting-ip"));
      const [ipHash, idHash] = await Promise.all([
        saltedHash(`${client}:${today()}`, salt),
        saltedHash(String(body.anonymousId), salt),
      ]);

      const counted = await counters(env).record(event, ipHash, idHash);
      // A rate-limited client is told nothing useful and isn't retried at — the
      // CLI ignores the response either way, and this shouldn't teach a scraper
      // where the cap is.
      return new Response(null, { status: counted ? 202 : 429, headers: CORS });
    }

    return json({ error: "Not found." }, 404);
  },
};
