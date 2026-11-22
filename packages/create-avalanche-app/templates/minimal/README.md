# __PROJECT_NAME__

An Avalanche dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit) — social-login onboarding, deploy-ready, black & white with dark/light from day one.

## Getting started

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. (social login, optional) add your own Web3Auth client ID
cp .env.example .env.local
#    → create a project at https://dashboard.web3auth.io (EVM): on Sapphire Devnet
#      for a testnet app, on Sapphire Mainnet for a mainnet app (see .env.example)

# 2. run it
npm run dev    # http://localhost:3000 (social login with the demo key works only on this port)
```

Then connect a wallet, read your balance, and send a first transaction on the chain this app was scaffolded for: `__CHAIN_CONST__` in `app/providers.tsx` (`fuji` is the Avalanche Fuji testnet, `cChain` is Avalanche C-Chain mainnet).

- **On Fuji** you can start instantly with a temporary in-browser wallet, use social login (it works out of the box on localhost through a bundled demo key), or connect Core / MetaMask. A new wallet gets its first test AVAX from a faucet — see [Test AVAX](#test-avax).
- **On C-Chain mainnet** every transaction costs real AVAX and there is no faucet: the app asks none, and a wallet is funded by its owner. The temporary wallet is not offered, and social login stays disabled until you set your own Sapphire Mainnet client ID in `.env.local` — connect Core / MetaMask, or add that client ID.

## Test AVAX

A new wallet is empty, so on Fuji the app asks a faucet for a little test AVAX: by itself for the
temporary wallet ("Start instantly"), with no account or sign-in anywhere, and with a
**Get test AVAX** button for any other wallet that holds none. By default that is AvaKit's shared
Fuji faucet — rate-limited (one small drip per address per day, with an hourly cap per IP address),
paid for by the AvaKit maintainer, and meant for first runs only: do not build a product on it.
When it refuses or is empty, the app shows the faucet's message, a **Try again** button and the
official faucet (needs a free Builder Hub sign-in). To run your own, deploy the Worker in
[`services/faucet`](https://github.com/mericcintosun/AvaKit/tree/main/services/faucet) and set
`NEXT_PUBLIC_AVAKIT_FAUCET_URL` to its `/fund` URL in `.env.local`; set it to `off` and the app
asks no faucet at all.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes

## Project layout

- `app/providers.tsx` — wallet + chain + theme providers
- `components/demo.tsx` — connect, balance, transaction
- `components/funding.tsx` — whether the wallet can pay for gas, and the faucet notice
- `app/globals.css` — shadcn tokens (black & white)

## AI-native

This project ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor already understand AvaKit and the project conventions.
