# What protects the faucet, and what does not

The faucet holds a throwaway Fuji key funded with test AVAX. The worst that
abuse can do is empty that key. Nothing on it has real value, and it cannot
sign for any chain but Fuji. This page says what slows a drain down, what
bounds it, and what cannot be done for the callers this faucet exists for.

## The layers

| Layer | Stops | Does not stop |
| --- | --- | --- |
| The testnet allowlist (`CHAINS`), and the chain id set at signing | A drip on any chain but Fuji, even with `FAUCET_FUJI_RPC` pointed elsewhere | — |
| Contract recipients refused, at most 100,000 gas per drip | A recipient that makes the faucet burn its balance on gas | — |
| One drip per address per 24 hours | Asking twice for the same wallet | A caller that makes a new address for every request, which costs nothing |
| Per client (an IPv4 address or an IPv6 /64): 20 drips per rolling hour, 8 in flight, 10 failed attempts per 5 minutes | One network draining the faucet quickly | Many networks: each proxy or botnet member gets its own 20 an hour |
| **Daily budgets** (`FAUCET_DAILY_DRIPS`, `FAUCET_DAILY_DRIPS_VERIFIED`) | The total sent per UTC day, over every caller together | A drain that spends the day's unverified budget, after which honest callers without a token are refused until 00:00 UTC |
| **Kill switch** (`FAUCET_PAUSED`) | Everything, at once, until it is switched off | — |
| Turnstile (off on the hosted faucet) | Scripts, on the verified budget: a token needs a solved challenge | Callers that cannot show a widget (below) |
| The monitor workflow | Nobody noticing a low balance, a spent budget or a pause | — |

The per-client limits were the only bound before the budgets. One client could
take 480 drips a day (9.6 AVAX at 0.02), more than the hosted faucet held
(3.79 AVAX on 2026-11-21), and ten networks together could empty it within an
hour.

## Why CORS is `*`

Three kinds of caller use the hosted faucet, and only one of them has an origin
we know:

- **Scaffolded apps.** Every app `create-avalanche-app` makes asks the faucet
  from the browser, on whatever origin the developer runs it: `localhost:3000`,
  a Vercel preview, their own domain. A list of allowed origins would break
  every one of them.
- **The MCP server** asks from Node.js, which sends no `Origin` at all. CORS
  does not apply to it.
- **avakit.dev**, the one origin we control.

CORS is enforced by browsers, for the protection of the person using the
browser. A script calling the faucet directly ignores it and sends any `Origin`
it likes. So a narrower `access-control-allow-origin` would break the first
kind of caller and stop no attacker. `FAUCET_CORS_ORIGIN` stays `*`; the
limits above are the defense.

## Why Turnstile cannot cover every caller

A Turnstile widget is created in the Cloudflare dashboard for a list of
hostnames, and its site key only works on those hostnames. A token proves that
a challenge was solved on one of them. That rules out most of the faucet's
callers:

- A scaffolded app runs on the developer's own hostname, where our widget does
  not render. Each developer could create their own widget, but its tokens
  would only verify with their own secret, not ours.
- The MCP server has no browser to show a challenge in.

So the faucet can only ask for a token where the page is ours: avakit.dev. That
is what `TURNSTILE_ORIGINS` does. With `TURNSTILE_SECRET` set, a request whose
`Origin` is listed must carry a token, and every other request may come without
one.

That alone would stop nothing, because a script sends whatever `Origin` it
likes. What makes it worth having is that the budgets are kept apart:

- A request with a token that Cloudflare verified draws on the **verified**
  budget, whatever its origin.
- Every other request draws on the **unverified** budget.

A script can spend the unverified budget, but it cannot reach the verified one
without solving a challenge for every drip. So once Turnstile is on, the people
on avakit.dev keep getting their drip after a script has spent the rest of the
day. Requiring the token from avakit.dev makes sure the site's own requests
always land on the verified side. README.md, "Turnstile", has the steps.

## The worst case, per day

At most `FAUCET_DAILY_DRIPS` + `FAUCET_DAILY_DRIPS_VERIFIED` drips go out per
UTC day, each of `FAUCET_DRIP_AVAX` plus its gas (at most 100,000 gas). With the
hosted settings in `wrangler.toml` that is 50 × 0.02 = 1 AVAX a day while
Turnstile is off, since without the secret no request is verified, and
1 + 100 × 0.02 = 3 AVAX once it is on.

A budget is in drips, not AVAX: raising `FAUCET_DRIP_AVAX` raises the worst
case with it. Keep the budgets small next to the balance, and keep the low
balance mark (`FAUCET_LOW_BALANCE_AVAX`) at one day's worst case or more. Then,
even at the worst case, the faucet still has about a day of drips left when its
balance crosses the mark: time for the monitor, which looks every six hours and
often starts late, to open its issue, and for someone to top the faucet up.
The hosted mark, 1 AVAX, is one day's worst case while Turnstile is off; it has
to go up to 3 AVAX before Turnstile is turned on (README.md, "Turnstile").

## When to pause

Pause the faucet when it is being drained faster than the budgets allow for,
when its key may have leaked, or when it is sending drips it should not:

```bash
cd services/faucet
echo 1 | npx wrangler secret put FAUCET_PAUSED   # takes effect at once
npx wrangler secret delete FAUCET_PAUSED         # resume
```

While paused, `POST /fund` answers `503 faucet_paused` and asks nothing of the
chain, and `GET /health` says `"paused": true`. Set it as a secret, not as a
dashboard variable: the next deploy removes dashboard variables, which would
switch the faucet back on without anyone deciding to. A rollback can get in
the way of the switch twice: rolling back to a version from before the pause
undoes it, and while a rolled-back version is live `wrangler secret put` fails
(see "Rolling back" in [services/DEPLOY.md](../DEPLOY.md)).

A key that may have leaked needs more than a pause: move what is left on it,
then `npx wrangler secret put AVAKIT_FAUCET_KEY` with a new throwaway key.

## The USDC drip (grant milestone D2) must require Turnstile

D2 adds a small Fuji USDC drip. That drip must only ever be drawn on a verified
budget of its own: no unverified budget for USDC at all, and therefore no USDC
for a request without a token Cloudflare vouched for.

- Test USDC is harder to replace than test AVAX. The faucet would refill it
  from Circle's faucet, which limits how often an address may ask, so a drained
  USDC pool stays empty for much longer.
- A token with a dollar name attracts more scripts than test AVAX does.

Two of the faucet's callers cannot solve a challenge, so this has to be decided
before D2 ships:

- **The MCP server.** An agent's session wallet can only get USDC through a
  person: for example, the server prints a link to a page on avakit.dev, the
  person solves the challenge there, and the page asks the faucet for the
  session wallet's USDC with the token.
- **The daily CI leg that pays the x402 template.** It cannot solve a challenge
  either. It needs a Fuji key of its own, funded with test USDC and kept as a
  repository secret, rather than the faucet.
