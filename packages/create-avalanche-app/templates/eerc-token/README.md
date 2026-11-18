# __PROJECT_NAME__

An Avalanche **confidential token** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit), built on Avalanche's [Encrypted ERC (eERC)](https://github.com/ava-labs/EncryptedERC) standard. Register, mint, and transfer tokens with hidden balances and amounts — right from your browser.

## Getting started

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
npm run dev    # http://localhost:3000 (or the port Next prints)
```

Then: connect a wallet → **Register** (one-time, on-chain) → **Unlock private balance** (free,
off-chain) → mint / confidential transfer / burn. These cost gas (except unlock); a new wallet gets
its first test AVAX from a faucet (see [Test AVAX](#test-avax)), and the buttons that send a
transaction wait until it has arrived.

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

## How it works

- Points at a shared, pre-deployed standalone eERC instance on Fuji (`lib/eerc-config.ts`) — no
  contract deployment needed to try the demo.
- Proofs (Groth16, via snarkjs) are generated entirely in the browser. Circuit `.wasm`/`.zkey`
  files load from a CDN (pinned to a commit of `ava-labs/EncryptedERC`), not bundled in this repo —
  and every file is verified against a pinned SHA-256 before the SDK proves against it, so a
  tampered CDN copy fails loudly instead of proving quietly.
- Minting is **owner-only** (eERC design, for compliance), so it stays disabled against the shared
  demo instance. Deploy your own with one command — `DEPLOYER_PRIVATE_KEY=0x... npm run deploy:eerc` —
  then connect the deployer wallet: the app walks you through the one-click auditor step and mint
  unlocks. Confidential transfer and burn work for any registered wallet.

## Pinned version and status

- **Circuits and contracts:** [`ava-labs/EncryptedERC`](https://github.com/ava-labs/EncryptedERC)
  at commit `c7eb0e09bc9315e68c35d3c09f5dce4b794d0485`. The browser loads the proving circuits from
  that commit (`CIRCUIT_COMMIT` in `lib/eerc-config.ts`, every file checked against a pinned
  SHA-256), and `npm run deploy:eerc` builds the contracts from the same commit (`COMMIT` in
  `scripts/deploy-eerc.mjs`). The two constants must stay equal.
- **SDK:** `@avalabs/eerc-sdk` 1.0.2, an exact version in `package.json`.
- Upstream merged security fixes with regenerated verifier keys on 2026-08-31 that are not in a tagged release yet; this template has not been moved to them.
- **Testnet only.** The shared instance and `npm run deploy:eerc` both live on Avalanche Fuji, and the
  scaffolder offers no other chain for this template. Do not put real funds behind it.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · `@avalabs/eerc-sdk` · wagmi · viem · shadcn/ui

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the
confidential-token flow and the (deliberate) ways this template differs from AvaKit's others.
