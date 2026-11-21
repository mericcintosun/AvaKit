# __PROJECT_NAME__

Launch **your own Avalanche L1** with one command, then explore it in a built-in dashboard — live blocks and transactions, your balance, and a deploy-a-contract button. Scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit).

> **Experimental.** This template depends on Avalanche CLI, which has been in maintenance mode
> since December 2025, and it was last proven end to end in July 2026. `create-avalanche-app`
> labels it experimental and warns when you choose it. See [Tooling status](#tooling-status).

## Getting started

> Requires a Unix-like shell (macOS, Linux, or **WSL2** on Windows): `npm run l1` runs bash +
> avalanche-cli. The pure-Fuji templates work on native Windows; this one needs WSL.

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. launch your L1 (needs avalanche-cli; downloads avalanchego on first run)
npm run l1
#    → creates a Subnet-EVM chain, deploys it locally, writes l1.config.json
#    optional: L1_NAME=mychain L1_CHAIN_ID=9999 L1_TOKEN=MYL1 npm run l1

# 2. run the app
npm run dev    # http://localhost:3000 (or the port Next prints)
```

Then: import the printed EWOQ dev key into your wallet (pre-funded on your chain, local-only) →
**Deploy demo token** → **Mint** → watch the transactions land in the built-in explorer.

## Tooling status

`npm run l1` and `npm run l1:fuji` (`scripts/l1.sh`, `scripts/l1-fuji.sh`) drive **Avalanche CLI** (the
`avalanche` command, from [ava-labs/avalanche-cli](https://github.com/ava-labs/avalanche-cli)). What to know
before you rely on it:

- Ava Labs put Avalanche CLI in maintenance mode in December 2025, and on 2026-10-06 removed its
  pages from the Avalanche documentation in favour of Platform CLI.
- This template was last proven end to end in July 2026, with Avalanche CLI 1.9.6 (check yours
  with `avalanche --version`). Both scripts have been changed since then, and the changed versions
  have not been through a full run on a live network yet. They read what
  `avalanche blockchain describe` prints, so another CLI version may need adjustments.
- Moving this template to the supported toolchain is planned work and is not done yet.

## Reset the network

```bash
avalanche network stop     # pause (keeps state)
avalanche network clean    # wipe (new blockchain ID — re-run npm run l1)
CLEAN=1 npm run l1         # wipe + rebuild in one step (use if a stale network blocks the deploy)
```

A wipe creates a brand-new chain, so the demo token you deployed is gone. The app notices on its own
— it only uses a remembered address while the chain still has code there — and offers **Deploy demo
token** again.

## What you get

- **Your own chain** — a real Subnet-EVM L1 running locally (no test AVAX, no faucet, no always-on node).
- **A built-in block explorer** — latest blocks, transactions, gas, and your balance, all read live
  from the chain's RPC with viem. No Docker, no third-party indexer.
- **Browser contract deploy** — a bundled ERC-20 you deploy and mint, so you can watch real
  transactions flow through your chain.

## Graduate to Fuji (advanced)

```bash
FUJI_KEY=mykey npm run l1:fuji    # mykey = a funded avalanche-cli key (the script explains how to get one)
```

Launches a **sovereign Proof-of-Authority** version of your chain on the public Fuji testnet: same
chain ID and token, production defaults, owned by your Fuji key. It is a separate avalanche-cli
config (named `<name>fuji`) — the local dev chain itself never goes to Fuji, because its genesis
pre-funds the public EWOQ key. The script never overwrites an existing config and is safe to re-run;
`npm run l1` points the app back at the local chain.

This needs test AVAX and a validator node that **stays running** (your machine can be it) — see
`CLAUDE.md` for the full walkthrough and caveats.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · avalanche-cli · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` — including an explainer for every L1 config
decision (VM, consensus/sovereignty, chain ID, token, `--test-defaults`, the EWOQ warning) so Claude
Code / Cursor can walk you through building your own chain.
