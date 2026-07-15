# @avakit/faucet-service

A **Cloudflare Worker** that drips testnet AVAX so an AvaKit app can fund a new
user's first transaction with zero wallet setup. It holds the funding key as a
Worker secret and rate-limits in KV, so AvaKit client code never touches a
private key.

This is the faucet behind **AvaKit Cloud** and `avakit.dev/new`. MIT — run your
own if you'd rather not use ours.

> Not part of the pnpm workspace; it deploys on its own. Cloudflare's free tier
> covers it (100k requests/day, KV included).

## Deploy

```bash
cd services/faucet
npm install

npx wrangler login

# 1. rate-limit store — paste the printed id into wrangler.toml
npx wrangler kv namespace create FAUCET_KV

# 2. the funding key (a THROWAWAY Fuji key — never one with real funds)
npx wrangler secret put AVAKIT_FAUCET_KEY

# 3. ship it
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

## Config

| Where | Name | Default | What |
| --- | --- | --- | --- |
| secret | `AVAKIT_FAUCET_KEY` | — (required) | 0x private key holding Fuji test AVAX |
| var | `FAUCET_DRIP_AVAX` | `0.05` | Amount per drip |
| var | `FAUCET_CORS_ORIGIN` | `*` | Set to `https://avakit.dev` once live |
| var | `FAUCET_FUJI_RPC` | public Fuji RPC | Override the RPC |
| kv | `FAUCET_KV` | — (required) | Rate-limit store |

## Endpoints

- `POST /fund` — `{ "address": "0x…", "chainId"?: 43113 }` → `{ txHash, amount, chainId }`
- `GET /health` — `{ ok, address, chainId, balance }`

## Limits

- One drip per **address** / 24h · max **5** per **IP** / hour (KV-backed).
- KV is eventually consistent, so these are a floor, not a hard guarantee — the
  small drip amount is the other half of that trade-off.
- **Add [Turnstile](https://developers.cloudflare.com/turnstile/) in front before
  advertising this widely.** The allowlist in `src/worker.js` only permits Fuji
  (43113), so it can never drip real funds.

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
