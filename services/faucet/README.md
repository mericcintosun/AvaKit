# @avakit/faucet-service

A **Cloudflare Worker** that drips testnet AVAX so an AvaKit app can fund a new
user's first transaction with zero wallet setup. It holds the funding key as a
Worker secret and counts drips in a Durable Object, so AvaKit client code never
touches a private key.

This is the faucet behind **AvaKit Cloud** and `avakit.dev/new`. MIT — run your
own if you'd rather not use ours.

> Not part of the pnpm workspace; it deploys on its own. Cloudflare's free tier
> covers it (100k requests/day, and SQLite-backed Durable Objects are included).

What protects it from being drained, and what cannot, is in
[PROTECTION.md](PROTECTION.md).

## Deploy

The hosted faucet is deployed by GitHub Actions: a change to this directory on
`main` waits for a maintainer's approval and then deploys, and `GET /health`
names the commit that is running. [`../DEPLOY.md`](../DEPLOY.md) has the
details and the one-time setup. The steps below are for a faucet of your own,
or for deploying by hand.

```bash
cd services/faucet
npm ci

npx wrangler login

# 1. the funding key (a THROWAWAY Fuji key — never one with real funds)
npx wrangler secret put AVAKIT_FAUCET_KEY

# 2. ship it — this also creates the Durable Object (see `[[migrations]]`)
npx wrangler deploy
```

Then fund it: `curl https://<worker>.workers.dev/health` prints the faucet's own
address — send it Fuji test AVAX. Finally point the site at it:

```bash
# Vercel → avakit.dev → Settings → Environment Variables
NEXT_PUBLIC_AVAKIT_FAUCET_URL = https://<worker>.workers.dev/fund
```

`avakit.dev/new` then funds each visitor's burner automatically. Without it the
page stays honest and links to the official Fuji faucet instead.

## Upgrading to the daily budgets

The first deploy of the daily budgets changes nothing a caller sends or gets
back on success. What it does:

- The Durable Object adds a `lane` column to its `drips` table the first time
  it starts (`ALTER TABLE`, run once; `test/upgrade.test.mjs` runs it in
  workerd). Every drip already stored was sent without Turnstile, so it counts
  as unverified.
- Today's budget starts with the drips already sent today, not from zero.
- Two refusals are new, and an older client reads them by their status:
  `429 daily_limited` (with `Retry-After` until 00:00 UTC) as a rate limit,
  and `503 faucet_paused` as an empty faucet. `@avakit/core` after 0.2.2 reads
  both by their code, the pause as `"paused"`. Neither is retried by
  `@avakit/core`, and both carry the faucet's own message.
- `GET /health` gains `version`, `low`, `lowBelow`, `paused` and `today`, and
  answers `ok: false` with the reason when it cannot work.
- `TURNSTILE_ORIGINS` is set to `https://avakit.dev` in `wrangler.toml`. On a
  faucet without `TURNSTILE_SECRET`, the hosted one included, that changes
  nothing (see [Turnstile](#turnstile)).
- **If your faucet already has `TURNSTILE_SECRET` set** and every caller sends
  a token, set `TURNSTILE_ORIGINS = ""` (or your own origins) in
  `wrangler.toml` before you deploy. With `https://avakit.dev` listed, only a
  request from that origin must carry a token: a request without one from any
  other origin is no longer refused, and is served from the unverified budget.
  `npx wrangler secret list` shows whether the secret is set.

## Upgrading a faucet that kept its limits in KV

For a faucet that is already running the earlier Worker, which kept its rate
limits in a KV namespace (`FAUCET_KV`) — the hosted `avakit-faucet` is one. From
`services/faucet`, in this order:

```bash
npm ci                      # the locked wrangler and viem
npx wrangler login
npx wrangler secret list    # AVAKIT_FAUCET_KEY must be in the list
npx wrangler deploy
curl https://<worker>.workers.dev/health
# one test drip, to an address of your own that was not funded today
curl -X POST https://<worker>.workers.dev/fund \
  -H 'content-type: application/json' \
  -d '{"address":"0x<your address>","chainId":43113}'
```

`/health` should answer `"ok": true` with the faucet's address, its balance,
`"amount": "0.02"` and `"turnstile": false`; the drip should answer
`{ txHash, amount, chainId }`, and the same request again `429 address_limited`.
If `secret list` shows `TURNSTILE_SECRET` on the faucet behind `avakit.dev/new`,
read [Turnstile](#turnstile) before deploying.

What that deploy does:

- It applies Durable Object migration `v1` (`new_sqlite_classes = ["Faucet"]`
  in `wrangler.toml`), which creates the `Faucet` class. That happens once.
- It drops the `FAUCET_KV` binding, because `wrangler.toml` no longer names it.
  The namespace itself stays in the account until you delete it:
  `npx wrangler kv namespace delete --namespace-id <id>`.
- The rate limits start empty, once. The counters in KV are not carried over,
  so every address and every client has its full allowance right after the
  deploy.
- Secrets set with `npx wrangler secret put` survive it: `AVAKIT_FAUCET_KEY`
  and, if you set them, `TURNSTILE_SECRET` and `FAUCET_FUJI_RPC`.
- The clients do not change: the request and the success answer are the same
  as before, so it does not matter whether the Worker, the site or the npm
  packages go out first.

Two more things, **not verified against a live account** — they could not be
tried without deploying:

- A plain-text variable that exists only in the Cloudflare dashboard is
  overwritten by the values in `wrangler.toml`: after the deploy it is gone
  (wrangler's configuration reference says so, under `keep_vars`). If the
  running faucet has `FAUCET_FUJI_RPC` set that way, set it as a secret first
  (`npx wrangler secret put FAUCET_FUJI_RPC`), which survives.
- Rolling back to the KV version after the migration probably takes more than
  redeploying the old code. That Worker has no `Faucet` class, so its
  `wrangler.toml` would most likely need the KV binding back and a further
  migration that removes the class, which also deletes the limits it stored:

  ```toml
  [[migrations]]
  tag = "v2"
  deleted_classes = ["Faucet"]
  ```

## Config

| Where | Name | Default | What |
| --- | --- | --- | --- |
| secret | `AVAKIT_FAUCET_KEY` | — (required) | 0x private key holding Fuji test AVAX |
| secret | `TURNSTILE_SECRET` | — (off) | Turns Turnstile on — see [Turnstile](#turnstile) |
| secret | `FAUCET_FUJI_RPC` | — (the public Fuji RPC) | Use your own RPC instead. A provider's URL carries its API key, so it is a secret — see below |
| secret | `FAUCET_PAUSED` | — (off) | The kill switch: any value but `0`, `false`, `no` or `off` refuses every drip — see [Pausing](#pausing) |
| var | `FAUCET_DRIP_AVAX` | `0.02` (set in `wrangler.toml`) | Amount per drip |
| var | `FAUCET_DAILY_DRIPS` | `50` | Drips per UTC day for every request without a verified Turnstile token, together. `0` closes this budget |
| var | `FAUCET_DAILY_DRIPS_VERIFIED` | `100` | Drips per UTC day for requests whose Turnstile token was verified |
| var | `FAUCET_LOW_BALANCE_AVAX` | `1` | `GET /health` answers `"low": true` under this balance, and the monitor opens an issue. Keep it at one day's worst case or more (see [PROTECTION.md](PROTECTION.md)). `0` turns the warning off |
| var | `TURNSTILE_ORIGINS` | `https://avakit.dev` (set in `wrangler.toml`) | The origins that must send a token once `TURNSTILE_SECRET` is set, separated by commas or spaces. Empty or unset: every caller must |
| var | `FAUCET_CORS_ORIGIN` | `*` | Left open on purpose: callers come from any origin, or none — see [PROTECTION.md](PROTECTION.md) |
| deploy | `GIT_SHA` | — (`"dev"`) | The commit, passed by the deploy workflow with `--var`; `GET /health` reports it as `version` |
| durable object | `FAUCET` | — (in `wrangler.toml`) | Rate limits, the daily budgets and the send queue, one object per chain |

A value the Worker cannot use (a budget that is not a whole number, an origin
with a path) is refused with `500 misconfigured` rather than guessed at, and
`GET /health` says which setting it is.

**An RPC URL with a key in it is a secret.** Set it with

```bash
npx wrangler secret put FAUCET_FUJI_RPC
```

and never under `[vars]`: `wrangler.toml` is committed, so a key written there
is published with the repository. A plain-text variable typed into the
Cloudflare dashboard instead is no better: it is shown to everyone with access
to the account, and wrangler treats `wrangler.toml` as the source of truth and
removes it on the next `wrangler deploy` (what wrangler documents for
`keep_vars`; not verified against a live account). The Worker reads the name
the same way whether it is a secret or a var (so a public, keyless URL may be a
var), but do not define it as both. The URL is never returned to a caller, and
it is redacted from everything the Worker logs.

## Endpoints

- `POST /fund` — `{ "address": "0x…", "chainId"?: 43113, "turnstileToken"?: "…" }`
  → `{ txHash, amount, chainId }`
- `GET /health` — the faucet's state, without a drip, for a client, an operator
  or the monitor workflow. It names no secret.

  ```jsonc
  {
    "ok": true,                 // set up, and its Durable Object answers
    "version": "4f2c…",         // the deployed commit, or "dev"
    "address": "0x…",           // the faucet's own account
    "chainId": 43113,
    "balance": "3791…",         // wei, as text; null if the RPC could not be asked
    "low": false,               // balance under lowBelow; null when unknown
    "lowBelow": "1",            // AVAX (FAUCET_LOW_BALANCE_AVAX)
    "amount": "0.02",           // what one drip sends, in AVAX
    "turnstile": false,         // whether POST /fund from this origin needs a token
    "paused": false,            // FAUCET_PAUSED
    "today": {                  // the daily budgets, UTC
      "day": "2026-11-21",
      "unverified": { "drips": 3, "max": 50 },
      "verified": { "drips": 0, "max": 100 }
    }
  }
  ```

  `turnstile` is answered for the origin the request comes from (the response
  says `Vary: Origin`): `curl -H 'Origin: https://avakit.dev' …/health` asks as
  the site would. A faucet that is set up wrong answers
  `500 { ok: false, version, error, code: "misconfigured" }`, and one whose
  Durable Object does not answer `503 { ok: false, version, error }`.

Anything else answers `{ "error": "…", "code": "…" }`. The message is fixed text
for people; branch on `code`:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_address`, `unsupported_chain` | The request is wrong; retrying won't help |
| 400 | `contract_recipient` | The address is a contract the faucet does not fund: it turns a plain transfer down, or paying it would take more than 100,000 gas. Use a wallet address |
| 403 | `turnstile_required`, `turnstile_failed` | No token, or one that is forged, expired or already used |
| 404 | `not_found` | Not one of the two endpoints |
| 429 | `address_limited`, `ip_limited` | Over a limit: the address was funded in the last 24 hours, or the client has had its 20 drips this hour or 10 failed attempts in five minutes. `Retry-After` says how many seconds until it clears |
| 429 | `daily_limited` | The day's budget for this kind of request is spent, for everyone. `Retry-After` counts down to 00:00 UTC |
| 502 | `drip_failed` | The RPC or the chain refused the transaction. No drip was charged to the caller's limits; retry shortly (it does count as a failed attempt) |
| 503 | `faucet_paused` | The operator has switched the faucet off (`FAUCET_PAUSED`). No `Retry-After`: it is off until someone switches it on |
| 503 | `faucet_empty`, `faucet_busy`, `turnstile_unavailable` | Out of funds, too many drips in flight (over all, from this client, or one to this very address; `Retry-After` is a few seconds), or Cloudflare's verification is unreachable |
| 500 | `misconfigured`, `internal` | The Worker's own setup (key, drip amount, a daily budget, the Turnstile origins) or a bug |

A failed drip never returns the upstream error. viem's messages include the RPC
URL and the raw request, so the detail goes to the Worker log instead
(`npm run tail`, or Workers Logs in the dashboard), with the RPC URL redacted.

## Limits

- One drip per **address** / 24h · max **20** per **client** in any rolling hour.
  The per-client cap is deliberately generous because a whole hackathon room
  shares one NAT'd IP, and that room is the audience this exists for.
- A client is an IPv4 address or an IPv6 **/64**. One subscriber is handed a
  whole /64, so counting single IPv6 addresses would count nothing.
- The limits are exact. Every request for a chain goes through one Durable
  Object, which checks and records a drip in a single step — a burst of
  parallel requests cannot all read the counter before any of them writes it.
- A drip only counts if its transaction goes out. If the send fails, the
  address and the client both get their allowance back.
- While a drip to an address is still being sent, a second request for that
  address gets `503 faucet_busy` with `Retry-After: 3`, not the 24-hour
  refusal: only once the transaction is out has the address been funded.
- A send that gets no answer (an HTTP error from the RPC, a timeout) is not
  taken for a failure. The faucet signed the transaction, so it looks it up by
  its hash for about two seconds: if the node has it, the drip counts and the
  caller gets `200` with the hash; if not, it is a `502` and nothing is counted.
  Either way the Worker logs `send answer lost` with the hash and `found`.
- The same object sends the transactions one at a time, so concurrent requests
  never sign the same nonce.
- At most **64** drips are in flight at once, and at most **8** of them from
  one client; a request beyond that gets `503 faucet_busy` with
  `Retry-After: 3`. One client can therefore not hold every slot.
- Failed attempts are counted per client: after **10** in any rolling five
  minutes the client is refused with `429 ip_limited` before the RPC is asked
  again. A failed drip is free for the caller but costs the faucet RPC calls,
  and the recipient that makes it fail is the caller's choice. An empty or
  misconfigured faucet is nobody's failed attempt and is not counted.
- A drip pays for at most **100,000 gas** (`MAX_DRIP_GAS` in `src/sender.js`).
  A wallet takes 21,000 and a smart-contract wallet a little more; a contract
  whose `receive()` needs more than the cap, or that reverts, is refused with
  `contract_recipient` instead of burning the faucet's balance on gas.
- The allowlist in `src/sender.js` only permits Fuji (43113), and every
  transaction is signed for that chain id whatever the RPC says — so the
  faucet cannot drip real funds, even with `FAUCET_FUJI_RPC` pointed at another
  network by mistake.
- To count, the object stores each drip's address for 24 hours, the client
  it came from for one hour, and the client of a failed attempt for five
  minutes. Its alarm deletes all three on schedule, so an IP address is gone
  an hour after its drip even if that was the day's last.
- Over all of that, a **budget per UTC day**: at most `FAUCET_DAILY_DRIPS`
  (50) drips for requests without a verified Turnstile token, together, and
  `FAUCET_DAILY_DRIPS_VERIFIED` (100) for requests with one. Once a budget is
  spent, every request that draws on it gets `429 daily_limited` until
  00:00 UTC. A drip being sent counts; one that fails is handed back. The
  budgets bound what all networks together can take in a day — see
  [PROTECTION.md](PROTECTION.md) for the worst case and what it does not stop.

The per-client limits bound what one network can take; the budgets bound all of
them together. Turnstile is what keeps a script out of the verified budget.

### Pausing

`FAUCET_PAUSED` is the kill switch. Set it, as a secret, and every `POST /fund`
is refused with `503 faucet_paused` before anything else is looked at:

```bash
echo 1 | npx wrangler secret put FAUCET_PAUSED   # pause, at once
npx wrangler secret delete FAUCET_PAUSED         # resume
```

`GET /health` keeps answering, with `"paused": true`, and the monitor keeps an
issue open while it is. A secret, not a dashboard variable: a deploy removes
dashboard variables and would switch the faucet back on.

### Turnstile

A captcha in front of `POST /fund`, enforced only once `TURNSTILE_SECRET` is
set. What it then asks of a request:

- A request that carries a `turnstileToken` has it checked, whatever its
  origin. A good one draws the drip on the verified budget; a bad one is
  refused with `403 turnstile_failed`.
- A request without a token is refused with `403 turnstile_required` if its
  `Origin` is one of `TURNSTILE_ORIGINS` — or always, when that setting is
  empty. Otherwise it is served from the unverified budget, like any request
  while Turnstile is off.

So `TURNSTILE_ORIGINS` decides who must send a token, and the budgets decide
what the ones who do not may take. [PROTECTION.md](PROTECTION.md) explains why
the hosted faucet can only ever ask avakit.dev for one.

> **The hosted faucet runs without it for now.** `avakit.dev/new` does not
> render a Turnstile widget yet, so it has no token to send, and with the
> secret set every drip from it would fail with `403 turnstile_required`.
> Everything else is ready: `TURNSTILE_ORIGINS` is already `https://avakit.dev`
> in `wrangler.toml`, so the MCP server and scaffolded apps keep working
> without a token once the secret is set. To turn it on:
>
> 1. Add a Turnstile widget in the Cloudflare dashboard for the hostname
>    `avakit.dev`. It gives a site key (public) and a secret key.
> 2. Render the widget on `avakit.dev/new` and pass its token with the drip
>    request (`turnstileToken` of `requestFaucet`, below). Deploy the site.
> 3. Check that the page sends a token: a request from it now carries
>    `turnstileToken`.
> 4. Make room for the verified budget first. With it the worst case grows
>    from 1 to 3 AVAX a day (50 + 100 drips of 0.02), so raise
>    `FAUCET_LOW_BALANCE_AVAX` in `wrangler.toml` to at least `3`, one day's
>    worst case, through a pull request (the deploy workflow ships it after
>    approval), and top the faucet up well above that. At `1`, the low-balance
>    issue would come less than eight hours before the faucet could run dry,
>    while the monitor only looks every six hours, and often late.
> 5. `npx wrangler secret put TURNSTILE_SECRET` with the secret key. From then
>    on `curl -H 'Origin: https://avakit.dev' …/health` answers
>    `"turnstile": true`, and the site's drips count under `today.verified`.

On a faucet of your own:

1. Add a [Turnstile](https://developers.cloudflare.com/turnstile/) widget in
   the Cloudflare dashboard for the hostnames that call the faucet. It gives
   you a site key (public) and a secret key.
2. Render the widget with the site key on the page that calls the faucet, and
   hand the token it produces to the client you use:

   ```tsx
   // @avakit/react: asked before every faucet request, the automatic drip included
   <AvaKitProvider faucetUrl="https://<worker>.workers.dev/fund" faucetToken={() => getToken()}>
   ```

   ```ts
   // @avakit/core: a string, or a function asked before every attempt
   await requestFaucet({ url, address, chainId: 43113, turnstileToken: () => getToken() });
   ```

   Both options are in the releases of `@avakit/core` and `@avakit/react` after
   0.2.1; an older client cannot send a token. Any other client puts the token
   in the request body as `turnstileToken`.
3. Set `TURNSTILE_ORIGINS` to the origins of those pages, or leave it empty if
   every caller of your faucet sends a token.
4. `npx wrangler secret put TURNSTILE_SECRET` with the secret key.

From step 4 on, a request without a valid token gets a `403` where one is
required — so do it last, once those pages send one. `GET /health` answers
`"turnstile": true` to a request from such an origin, which is how a client or
an operator can tell without a drip. A token is single-use and expires after
five minutes; ask the widget for a fresh one per request (which is why both
clients take a function). If Cloudflare's verification cannot be reached the
faucet answers `503` rather than letting everyone through.

## Local

```bash
cp .env.example .dev.vars    # gitignored — put a throwaway Fuji key in it
npx wrangler dev
curl http://localhost:8787/health
```

`wrangler dev` runs the Worker and its Durable Object locally, but a drip is a
real Fuji transaction from whatever key is in `.dev.vars`.

## Tests

```bash
npm install
npm test
```

Needs Node 22.15 or newer. The suite never touches a network: it runs the
Worker in local `workerd` straight from `wrangler.toml`, against a mock chain
(`test/helpers/mock-chain.mjs`) that rejects nonce conflicts the way a real
node does, and it generates its keys on the spot. The daily budgets are also
run in plain Node with a clock the test moves (`test/budget.test.mjs`), and the
upgrade of a table from before them in workerd (`test/upgrade.test.mjs`, with
the fixture in `test/fixtures/upgrade/`), along with the code from before them
running on the upgraded table again, as it would after a rollback.

## Wire it into any app

```tsx
<AvaKitProvider
  chains={[fuji]}
  adapters={[burnerAdapter({ chain: fuji })]}
  faucetUrl="https://<worker>.workers.dev/fund"
>
  {children}
</AvaKitProvider>
```

A burner is then auto-funded on connect; `useFaucet()` also exposes a manual
`fund()` for a "get test AVAX" button.
