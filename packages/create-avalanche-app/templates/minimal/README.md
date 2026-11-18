# __PROJECT_NAME__

An Avalanche dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit) — social-login onboarding, deploy-ready, black & white with dark/light from day one.

## Getting started

```bash
# 1. (social login, optional) add your own Web3Auth client ID
cp .env.example .env.local
#    → create a project at https://dashboard.web3auth.io (EVM): on Sapphire Devnet
#      for a testnet app, on Sapphire Mainnet for a mainnet app (see .env.example)

# 2. run it
pnpm dev    # http://localhost:3000 (or the port Next prints)
```

Then connect a wallet, read your balance, and send a first transaction on the chain this app was scaffolded for: `__CHAIN_CONST__` in `app/providers.tsx` (`fuji` is the Avalanche Fuji testnet, `cChain` is Avalanche C-Chain mainnet).

- **On Fuji** you can start instantly with a temporary in-browser wallet, use social login (it works out of the box on localhost through a bundled demo key), or connect Core / MetaMask. Need test AVAX? Use the in-app faucet link or https://core.app/tools/testnet-faucet.
- **On C-Chain mainnet** every transaction costs real AVAX and there is no faucet. The temporary wallet is not offered, and social login stays disabled until you set your own Sapphire Mainnet client ID in `.env.local` — connect Core / MetaMask, or add that client ID.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes

## Project layout

- `app/providers.tsx` — wallet + chain + theme providers
- `components/demo.tsx` — connect, balance, transaction
- `app/globals.css` — shadcn tokens (black & white)

## AI-native

This project ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor already understand AvaKit and the project conventions.
