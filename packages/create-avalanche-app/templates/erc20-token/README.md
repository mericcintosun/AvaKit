# __PROJECT_NAME__

An Avalanche **ERC-20 token** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Deploy a token from your browser, mint, and transfer — no Foundry required to run it.

## Getting started

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
npm run dev    # http://localhost:3000 (or the port Next prints)
```

Then: connect a wallet → **Deploy token contract** → **Mint 100 AKT** → **Burn 10 AKT**. These cost gas; a new wallet gets its first test AVAX from a faucet (see [Test AVAX](#test-avax)), and the buttons wait until it has arrived.

The app remembers the token you deployed (in your browser, per chain), so a reload picks up where you left off. **Deploy a new token** starts over — use it after you change the contract.

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

## How the token works

- `contracts/src/AvaKitToken.sol` — a minimal, self-contained ERC-20 (AKT, 18 decimals) with a public `mint()` demo faucet.
- `lib/token-artifact.ts` — the compiled ABI + bytecode, bundled for browser deploy via `useAvaDeploy()`.

Amounts are in wei — convert with `parseUnits` / `formatUnits` (18 decimals).

```bash
cd contracts && forge build   # recompile after editing the contract
```

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the token flow and conventions.
