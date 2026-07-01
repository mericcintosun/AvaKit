# __PROJECT_NAME__

An Avalanche dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit) — social-login onboarding, deploy-ready, black & white with dark/light from day one.

## Getting started

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → get one at https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
pnpm dev    # http://localhost:3000
```

Then connect a wallet (social login or Core / MetaMask), read your balance, and send a first transaction on Avalanche Fuji.

> Need test AVAX? Use the in-app faucet link or https://core.app/tools/testnet-faucet.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes

## Project layout

- `app/providers.tsx` — wallet + chain + theme providers
- `components/demo.tsx` — connect, balance, transaction
- `app/globals.css` — shadcn tokens (black & white)

## AI-native

This project ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor already understand AvaKit and the project conventions.
