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

## Tests

```bash
npm install
npm test
```

Needs Node 22.15 or newer. `test/worker.test.mjs` and `test/purge.test.mjs` load
the Worker in plain Node (with a stand-in for `cloudflare:workers` and an
in-memory SQLite database) so they can move the clock and look inside the
storage; `test/workerd.test.mjs` runs the same Worker in local `workerd`
straight from `wrangler.toml`. None of them touches a network.

## Adding a template

`template` is the one reported field that becomes a visible label on the stats
page, so the collector accepts an exact list — `src/templates.js` — and files
everything else under `"other"`. When `create-avalanche-app` gains a template,
add its id to that list and deploy the collector. Until you do, its scaffolds
are still counted, just as `"other"`; `npm test` fails while the list and
`packages/create-avalanche-app/templates/` disagree.

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

## Removing test events

The collector cannot tell a test from a real scaffold: a locally built CLI that
runs without `AVAKIT_TELEMETRY_DISABLED=1` reports to the live collector like
anybody else's. `POST /admin/purge` takes a day of that back out of the counts.

**It is for the project's own test runs and nothing else.** Never use it on real
usage, whatever the numbers look like — they are only worth publishing while
nobody edits them. It can remove counts, never add them.

The route does not exist (`404`) until `TELEMETRY_ADMIN_TOKEN` is set, so switch
it on first:

```bash
cd services/telemetry

# The token that opens the route: any random string of 32 characters or more
# (`openssl rand -hex 32`). With a shorter one the route stays off and answers
# 500, saying so. You paste the token here, and once more below.
npx wrangler secret put TELEMETRY_ADMIN_TOKEN

# Ships the route itself. Only needed while the deployed Worker predates it.
npx wrangler deploy
```

Then look before deleting. Days are UTC, the same days as `byDay` in `/stats`:

```bash
URL=https://avakit-telemetry.avakit.workers.dev/admin/purge
read -rs TOKEN   # paste the token: it is not echoed and stays out of shell history

# 1. Dry run — reports what is stored for the day and deletes nothing.
curl -sS -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "day": "2026-11-18", "dryRun": true }'
# e.g. {"day":"2026-11-18","dryRun":true,"rows":9,"events":52,"succeeded":50}

# 2. For real — once those are the test run's numbers and nothing more.
curl -sS -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "day": "2026-11-18" }'
# e.g. {"day":"2026-11-18","dryRun":false,"rows":9,"events":52,"succeeded":50}
```

`rows` is how many `scaffolds` rows went, `events` the sum of their counts (what
`scaffolds.total` drops by) and `succeeded` the successful ones among them (what
`scaffolds.succeeded`, the number on the stats page, drops by).

**It removes the whole day.** The rows are aggregates with nothing in them to
say who sent what, so a purge cannot pick the test events out of a day. That is
what the dry run is for: if `events` is more than the test run sent, the
difference is real usage, and it would go too.

A test run also leaves an install behind (`installs` in `/stats`). To take it
out with the day, add its id to the body of both calls:

```bash
  -d '{ "day": "2026-11-18", "installId": "<anonymousId>", "dryRun": true }'
# e.g. {…,"install":{"found":true,"firstDay":"2026-11-18","removed":false}}

  -d '{ "day": "2026-11-18", "installId": "<anonymousId>" }'
# e.g. {…,"install":{"found":true,"firstDay":"2026-11-18","removed":true}}
```

`installId` is the `anonymousId` in the config of the CLI that ran the tests:
`~/.config/avakit/config.json`, or `config.json` in the `AVAKIT_CONFIG_DIR` the
run used. The install is removed only if it was **first seen on that day**. One
seen earlier is a real install that also ran that day, and it stays. `removed`
says what this call did, so a dry run always answers `false`: there, the install
will go if its `firstDay` is the `day` you sent.

The route answers `401` to a missing or wrong token and `400` to a body it does
not fully understand — an unknown field, an impossible date, a `dryRun` that is
not `true` or `false`. It deletes, so it refuses rather than guesses.

Afterwards:

- The purge drops the memoised aggregate, so `/stats` is recomputed at once in
  the Durable Object and in the Worker isolate that handled the call. Other
  isolates serve the copy they hold for up to five more minutes, and
  avakit.dev/stats revalidates its own every five minutes on top of that. To
  check straight away, repeat the dry run: it reads storage directly and now
  answers `"rows":0`.
- Every purge, dry run or not, is logged with the day and the numbers (never
  the token or the install id); `npx wrangler tail` shows it as it happens.
- Switch the route off again: `npx wrangler secret delete TELEMETRY_ADMIN_TOKEN`.

To rehearse it, add `TELEMETRY_ADMIN_TOKEN` to `.dev.vars` and aim the same
commands at `http://localhost:8787/admin/purge`.

## Endpoints

- `POST /e` — one scaffold event. `202` if counted, `429` if the caller is over
  its daily cap, `400` if the body isn't a recognised event. The CLI ignores the
  response either way.
- `GET /stats` — the public aggregate, computed at most once every 5 minutes.
- `GET /health` — `{ ok: true }`.
- `POST /admin/purge` — for the maintainer, and `404` unless
  `TELEMETRY_ADMIN_TOKEN` is set. See [Removing test events](#removing-test-events).

A `cache-control` header does not make Cloudflare cache a response a Worker
generated, so the collector does the caching itself: the Durable Object keeps
the aggregate it last computed for five minutes, and each Worker isolate keeps
its copy until the same deadline. However often `/stats` is requested, the
aggregate queries run once per window. `cache-control: public, max-age=…` on the
response counts down to that deadline, for browsers and other caches downstream.

`/stats` returns:

```jsonc
{
  "scaffolds": {
    "total": 0,        // every attempt
    "succeeded": 0,    // ok only
    "last30d": 0,      // ok only
    "byTemplate": {},  // ok only, descending; keys are shipped template ids or "other"
    "byDay": []        // ok only, ascending; days with no scaffolds are absent
  },
  "failures": {},      // errorKind → count; tells our bug apart from user error
  "installs": 0,       // distinct anonymous ids
  "firstDay": null,    // null until the first event lands
  "updatedAt": "…"     // when these numbers were read from storage
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
| `scaffolds` | one per (day, template, wallet, chain, pm, cli, platform, ok, error kind) | a count |
| `installs` | one per install | salted hash of the CLI's random id, first/last day, count |
| `rate` | one per (client, day), pruned daily | salted hash, a count |

`wallet` is vestigial. `create-avalanche-app` stopped reporting it in 0.4.0 —
every scaffold ships all the wallets, so there was nothing left to choose — and
the column holds `"other"` for every scaffold from a CLI since then. It stays
because it is part of the table's primary key and a live table is not migrated
(see [Changing the schema](#changing-the-schema)); nothing reads it, and
`/stats` does not report it.

**No IP is ever stored.** Rate limiting keys off `SHA-256(salt + client + today)`,
which is deleted the next day and can't be walked back to an IP without the
salt. The CLI's `anonymousId` is a random uuid with nothing derived from the
machine, and even that is hashed before it lands.

Every field is normalised to a bounded enum on the way in (see `SHAPES` in
`src/worker.js`); anything unrecognised becomes `"other"`, so a new template
shipping doesn't stop counting and a hostile client can't invent unbounded rows
or put a label of its own on the stats page. `/stats` applies the same list on
the way out, so a label stored before `template` became an exact list is
reported as `"other"` as well.

## Limits

- **60 events per client per day.** A human doesn't scaffold 60 apps a day; a
  loop does. A client is an IPv4 address or an IPv6 /64 — one subscriber is
  handed a whole /64, so a cap per IPv6 address would be no cap.
- This is **self-reported by a client we don't control**, so the number is a
  floor with a spoofable ceiling. `/stats` says exactly that, and the npm
  download count sitting next to it is the independent cross-check. Treat it as
  evidence, not as an audited figure.
