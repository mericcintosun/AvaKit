# __PROJECT_NAME__

An Avalanche **confidential token** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit), built on Avalanche's [Encrypted ERC (eERC)](https://github.com/ava-labs/EncryptedERC) standard. Register, mint, and transfer tokens with hidden balances and amounts — right from your browser.

## Getting started

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
pnpm dev    # http://localhost:3000 (or the port Next prints)
```

Then: connect a wallet → **Register** (one-time, on-chain) → **Unlock private balance** (free,
off-chain) → mint / confidential transfer / burn. These cost gas (except unlock), so fund your
wallet on Fuji first (in-app faucet link).

## How it works

- Points at a shared, pre-deployed standalone eERC instance on Fuji (`lib/eerc-config.ts`) — no
  contract deployment needed to try the demo.
- Proofs (Groth16, via snarkjs) are generated entirely in the browser. Circuit `.wasm`/`.zkey`
  files load from a CDN (pinned to a commit of `ava-labs/EncryptedERC`), not bundled in this repo —
  and every file is verified against a pinned SHA-256 before the SDK proves against it, so a
  tampered CDN copy fails loudly instead of proving quietly.
- Minting is **owner-only** (eERC design, for compliance), so it stays disabled against the shared
  demo instance. Deploy your own with one command — `DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:eerc` —
  then connect the deployer wallet: the app walks you through the one-click auditor step and mint
  unlocks. Confidential transfer and burn work for any registered wallet.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · `@avalabs/eerc-sdk` · wagmi · viem · shadcn/ui

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the
confidential-token flow and the (deliberate) ways this template differs from AvaKit's others.
