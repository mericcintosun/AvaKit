# @avakit/faucet-service

A **Cloudflare Worker** that drips testnet AVAX so an AvaKit app can fund a new
user's first transaction with zero wallet setup. It holds the funding key as a
Worker secret and counts drips in a Durable Object, so AvaKit client code never
touches a private key.

This is the faucet behind **AvaKit Cloud** and `avakit.dev/new`. MIT — run your
own if you'd rather not use ours.

> Not part of the pnpm workspace; it deploys on its own. Cloudflare's free tier
> covers it (100k requests/day, and SQLite-backed Durable Objects are included).

## Deploy

```bash
cd services/faucet
npm install

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

**Upgrading a faucet deployed before the Durable Object.** Earlier versions kept
their rate limits in a KV namespace (`FAUCET_KV`). Nothing needs migrating:
`npx wrangler deploy` creates the Durable Object and the limits start empty.
The old namespace is no longer bound and can be deleted with
`npx wrangler kv namespace delete --namespace-id <id>`.

## Config

| Where | Name | Default | What |
| --- | --- | --- | --- |
| secret | `AVAKIT_FAUCET_KEY` | — (required) | 0x private key holding Fuji test AVAX |
| secret | `TURNSTILE_SECRET` | — (off) | Set it and `POST /fund` requires a Turnstile token — see [Turnstile](#turnstile-optional) |
| secret | `FAUCET_FUJI_RPC` | — (the public Fuji RPC) | Use your own RPC instead. A provider's URL carries its API key, so it is a secret — see below |
| var | `FAUCET_DRIP_AVAX` | `0.02` (set in `wrangler.toml`) | Amount per drip |
| var | `FAUCET_CORS_ORIGIN` | `*` | Left open on purpose: CORS is a browser rule, not a security boundary, and locking it down only breaks local dev and preview deploys |
| durable object | `FAUCET` | — (in `wrangler.toml`) | Rate limits and the send queue, one object per chain |

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
- `GET /health` — `{ ok, address, chainId, balance, turnstile }`. `turnstile` is
  `true` when `POST /fund` expects a token.

Anything else answers `{ "error": "…", "code": "…" }`. The message is fixed text
for people; branch on `code`:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_address`, `unsupported_chain` | The request is wrong; retrying won't help |
| 400 | `contract_recipient` | The address is a contract the faucet does not fund: it turns a plain transfer down, or paying it would take more than 100,000 gas. Use a wallet address |
| 403 | `turnstile_required`, `turnstile_failed` | No token, or one that is forged, expired or already used |
| 404 | `not_found` | Not one of the two endpoints |
| 429 | `address_limited`, `ip_limited` | Over a limit: the address was funded in the last 24 hours, or the client has had its 20 drips this hour or 10 failed attempts in five minutes. `Retry-After` says how many seconds until it clears |
| 502 | `drip_failed` | The RPC or the chain refused the transaction. No drip was charged to the caller's limits; retry shortly (it does count as a failed attempt) |
| 503 | `faucet_empty`, `faucet_busy`, `turnstile_unavailable` | Out of funds, too many drips in flight (over all, from this client, or one to this very address; `Retry-After` is a few seconds), or Cloudflare's verification is unreachable |
| 500 | `misconfigured`, `internal` | The Worker's own setup (key, drip amount) or a bug |

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

These bound what one network can take. They do not stop a thousand networks —
that is what Turnstile is for.

### Turnstile (optional)

A captcha in front of `POST /fund`. It is enforced only when `TURNSTILE_SECRET`
is set, so turning it on needs no code change in the Worker — but it does need
every client of the faucet to send a token first.

> **The hosted faucet runs without it, and has to for now.** The public demo
> page (`avakit.dev/new`) does not render a Turnstile widget yet, so it has no
> token to send. Setting `TURNSTILE_SECRET` on the faucet behind that page makes
> every drip from it fail with `403 turnstile_required`. Leave the secret unset
> there until the page sends a token.

On your own faucet:

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
3. `npx wrangler secret put TURNSTILE_SECRET` with the secret key.

From step 3 on, a request without a valid token gets a `403` — so do it last,
once every client of this faucet sends one. `GET /health` answers
`"turnstile": true` from then on, which is how a client or an operator can tell
without a drip. A token is single-use and expires after five minutes; ask the
widget for a fresh one per request (which is why both clients take a function).
If Cloudflare's verification cannot be reached the faucet answers `503` rather
than letting everyone through.

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
node does, and it generates its keys on the spot.

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
