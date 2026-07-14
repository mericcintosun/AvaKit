# @avakit/faucet-service

A tiny, self-hostable **testnet AVAX faucet** so an AvaKit app can fund a new
user's first transaction with zero wallet setup. It holds the funding key
(server-side, from env) and enforces rate limits, so AvaKit client code never
touches a private key.

This is the reference implementation behind **AvaKit Cloud's** hosted faucet. It's
MIT and standalone — run your own, or point at AvaKit Cloud's.

> Not part of the pnpm workspace — it's deployed independently (Railway,
> Fly.io, a container, or adapt it to Cloudflare Workers). Node ≥ 20.11.

## Run

```bash
cd services/faucet
npm install
AVAKIT_FAUCET_KEY=0x<throwaway-fuji-key> npm start
```

Use a **throwaway** key funded only with Fuji test AVAX. Never a key with real
funds. The allowlist refuses any non-testnet chain, so it can never drip mainnet.

## Config (env)

| Var | Default | What |
| --- | --- | --- |
| `AVAKIT_FAUCET_KEY` | — (required) | 0x private key that holds Fuji test AVAX |
| `PORT` | `8787` | Listen port |
| `FAUCET_DRIP_AVAX` | `0.05` | Amount per drip |
| `FAUCET_CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` (set to your app origin) |
| `FAUCET_FUJI_RPC` | public Fuji RPC | Override the Fuji RPC endpoint |

## Endpoints

- `POST /fund` — body `{ "address": "0x…", "chainId"?: 43113 }` → `{ txHash, amount, chainId }`
- `GET /health` — `{ ok, address, chainId, balance }`

## Rate limits (in-memory)

- One drip per **address** per 24h.
- Max **5** drips per **IP** per hour.

For a multi-instance deploy, swap the in-memory maps for a shared store (Redis /
KV), and **put a captcha in front** (e.g. Cloudflare Turnstile) — the built-in
limits are a floor, not a full anti-abuse defense.

## Wire it into an app

```tsx
<AvaKitProvider chains={[fuji]} adapters={[burnerAdapter({ chain: fuji })]}
  faucetUrl="https://faucet.avakit.dev/fund">
  {children}
</AvaKitProvider>
```

A burner wallet is then auto-funded on connect; `useFaucet()` also exposes a
manual `fund()` for a "get test AVAX" button.
