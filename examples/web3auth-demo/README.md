# examples/web3auth-demo

An Avalanche **NFT mint** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Deploy an ERC-721 from your browser, then mint — no Foundry required to run it.

## Getting started

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
pnpm dev    # http://localhost:3000
```

Then: connect a wallet → **Deploy NFT contract** → **Mint NFT**. Deploying and minting cost gas, so fund your wallet on Fuji first (in-app faucet link).

## How the contract works

- `contracts/src/AvaKitNFT.sol` — a minimal, self-contained ERC-721 (no external deps; compiles with `forge build` out of the box).
- `lib/nft-artifact.ts` — the compiled ABI + bytecode, bundled so the app can deploy straight from the browser via `useAvaDeploy()`.

To change the contract, edit `contracts/src/AvaKitNFT.sol`, then regenerate the bundled artifact (needs Foundry):

```bash
# from the repository root
cd contracts-ci && node scripts/check-artifacts.mjs --write
```

That rebuilds the contract with the repository's pinned compiler settings and rewrites the ABI and bytecode in `lib/nft-artifact.ts` in place. Do not copy them over by hand: CI runs the same script without `--write` and fails when the artifact no longer matches the source.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand AvaKit, the deploy/mint flow, and the contract workflow.
