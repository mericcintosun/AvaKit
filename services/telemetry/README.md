# @avakit/telemetry-service

A **Cloudflare Worker** that counts anonymous `create-avalanche-app` scaffolds and
serves the aggregate behind [avakit.dev/stats](https://avakit.dev/stats).

We run this because "does anyone use this?" needs a number, not a vibe — the
Avalanche grant programs (Retro9000 especially) score on demonstrated usage, and
npm's download count can't tell a human from a mirror or say which template
anyone picked.

What the CLI sends, what it never sends, and how to turn it off are documented
for users at [avakit.dev/docs/telemetry](https://avakit.dev/docs/telemetry) —
that page is the contract; this service implements it.

> Not part of the pnpm workspace; it deploys on its own. Cloudflare's free tier
> covers it (100k requests/day, 100k Durable Object rows written/day).

## Why a Durable Object and not KV

KV would need a read-modify-write per counter. That races — two scaffolds in the
same instant read the same value and one increment is silently lost — and KV
caps at **one write per second per key**, which a single global counter row would
hit. On a number we intend to publish, neither is acceptable. A SQLite-backed
Durable Object serialises writes, is transactional, and its free tier is 100k
rows/day against KV's 1k writes/day.

## Deploy

```bash
cd services/telemetry
npm install

npx wrangler login

# The salt that makes the rate-limit hashes irreversible. Any long random string:
#   openssl rand -hex 32
npx wrangler secret put TELEMETRY_SALT

npx wrangler deploy
```

The CLI defaults to `https://avakit-telemetry.avakit.workers.dev/e`; point it
somewhere else with `AVAKIT_TELEMETRY_URL`. The site reads `/stats` via
`AVAKIT_TELEMETRY_STATS_URL`.

## Local

```bash
echo 'TELEMETRY_SALT = "dev-salt"' > .dev.vars   # gitignored
npx wrangler dev

# then, in another shell:
AVAKIT_TELEMETRY_URL=http://localhost:8787/e npx create-avalanche-app demo -y --no-install
curl http://localhost:8787/stats
```

## Changing the schema

The tables are created with `CREATE TABLE IF NOT EXISTS`, which **does not
migrate an existing one**. Deploying a changed column list on top of a live
Durable Object leaves the old table in place and every insert then fails on the
missing column. Either write a real `ALTER TABLE` migration in the constructor,
or — while the counts are still small enough not to matter — wipe and start over:

```bash
npx wrangler delete --force   # drops the Durable Object's storage with it
npx wrangler secret put TELEMETRY_SALT
npx wrangler deploy
```

Give it a minute afterwards. A fresh `workers.dev` route takes ~30s to answer at
all (a **1042** right after deploying is propagation, not a fault), and for a few
seconds after a delete the old Durable Object is still being torn down and
`/stats` answers **1101**. Both clear on their own — retry before debugging.

## Endpoints

- `POST /e` — one scaffold event. `202` if counted, `429` if the caller is over
  its daily cap, `400` if the body isn't a recognised event. The CLI ignores the
  response either way.
- `GET /stats` — the public aggregate (cached 5 minutes at the edge).
- `GET /health` — `{ ok: true }`.

`/stats` returns:

```jsonc
{
  "scaffolds": {
    "total": 0,        // every attempt
    "succeeded": 0,    // ok only
    "last30d": 0,      // ok only
    "byTemplate": {},  // ok only, descending
    "byDay": []        // ok only, ascending; days with no scaffolds are absent
  },
  "failures": {},      // errorKind → count; tells our bug apart from user error
  "installs": 0,       // distinct anonymous ids
  "firstDay": null,    // null until the first event lands
  "updatedAt": "…"
}
```

Only `total` counts failures, so the breakdowns reconcile —
`sum(byTemplate) === succeeded` and `sum(byDay) === last30d`. Failures are
`total - succeeded`. Note `byDay` omits empty days rather than reporting zeros;
a caller plotting a time series has to zero-fill, or it will imply a line where
there was no activity.

## What is stored

| Table | Rows | Holds |
| --- | --- | --- |
| `scaffolds` | one per (day, template, wallet, chain, pm, cli, platform, ok) | a count |
| `installs` | one per install | salted hash of the CLI's random id, first/last day, count |
| `rate` | one per (IP, day), pruned daily | salted hash, a count |

**No IP is ever stored.** Rate limiting keys off `SHA-256(salt + IP + today)`,
which is deleted the next day and can't be walked back to an IP without the
salt. The CLI's `anonymousId` is a random uuid with nothing derived from the
machine, and even that is hashed before it lands.

Every field is normalised to a bounded enum on the way in (see `SHAPES` in
`src/worker.js`); anything unrecognised becomes `"other"`, so a new template
shipping doesn't stop counting and a hostile client can't invent unbounded rows.

## Limits

- **60 events per IP per day.** A human doesn't scaffold 60 apps a day; a loop
  does.
- This is **self-reported by a client we don't control**, so the number is a
  floor with a spoofable ceiling. `/stats` says exactly that, and the npm
  download count sitting next to it is the independent cross-check. Treat it as
  evidence, not as an audited figure.
