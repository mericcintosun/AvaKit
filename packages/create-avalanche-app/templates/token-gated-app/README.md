# __PROJECT_NAME__

A **token-gated** Avalanche dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Content unlocks for holders of an access-pass NFT — no Foundry required to run it.

## Getting started

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
pnpm dev    # http://localhost:3000 (or the port Next prints)
```

Then: connect a wallet → **Deploy access-pass contract** → **Mint access pass** → the gated content unlocks. Deploying and minting cost gas, so fund your wallet on Fuji first (in-app faucet link).

## How the gate works

The gated section renders only when `balanceOf(address) > 0`:

```ts
const balance = (await useContract({ address, abi }).read("balanceOf", [address])) as bigint;
const hasAccess = balance > 0n;
```

- `contracts/src/AvaKitNFT.sol` — the access-pass ERC-721 (self-contained).
- `lib/nft-artifact.ts` — compiled ABI + bytecode, bundled for browser deploy.

> **Security:** client-side gating is illustrative. For real protected content, verify ownership server-side (e.g. Sign-In with Ethereum + an API check).

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the gate pattern and project conventions.
