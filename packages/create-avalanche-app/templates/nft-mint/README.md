# __PROJECT_NAME__

An Avalanche **NFT mint** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Deploy an ERC-721 from your browser, then mint — no Foundry required to run it.

## Getting started

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
npm run dev    # http://localhost:3000 (or the port Next prints)
```

Then: connect a wallet → **Deploy NFT contract** → **Mint NFT**. Deploying and minting cost gas; a new wallet gets its first test AVAX from a faucet (see [Test AVAX](#test-avax)), and both buttons wait until it has arrived.

The app remembers the contract you deployed (in your browser, per chain), so a reload picks up where you left off. **Deploy a new contract** starts over — use it after you change the contract.

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

## How the contract works

- `contracts/src/AvaKitNFT.sol` — a minimal, self-contained ERC-721 (no external deps; compiles with `forge build` out of the box).
- `lib/nft-artifact.ts` — the compiled ABI + bytecode, bundled so the app can deploy straight from the browser via `useAvaDeploy()`.

To change the contract:

```bash
cd contracts && forge build
# copy out/AvaKitNFT.sol/AvaKitNFT.json (abi + bytecode.object) into lib/nft-artifact.ts
```

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand AvaKit, the deploy/mint flow, and the contract workflow.
