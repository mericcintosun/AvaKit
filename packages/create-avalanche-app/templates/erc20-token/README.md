# __PROJECT_NAME__

An Avalanche **ERC-20 token** dapp scaffolded with [AvaKit](https://github.com/avakit/avakit). Deploy a token from your browser, mint, and transfer — no Foundry required to run it.

## Getting started

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
pnpm dev    # http://localhost:3000
```

Then: connect a wallet → **Deploy token contract** → **Mint 100 AKT** → **Burn 10 AKT**. These cost gas, so fund your wallet on Fuji first (in-app faucet link).

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
