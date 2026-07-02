# __PROJECT_NAME__

Launch **your own Avalanche L1** with one command, then explore it in a built-in dashboard — live blocks and transactions, your balance, and a deploy-a-contract button. Scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit).

## Getting started

> Requires a Unix-like shell (macOS, Linux, or **WSL2** on Windows): `pnpm l1` runs bash +
> avalanche-cli. The pure-Fuji templates work on native Windows; this one needs WSL.

```bash
# 1. launch your L1 (needs avalanche-cli; downloads avalanchego on first run)
pnpm l1
#    → creates a Subnet-EVM chain, deploys it locally, writes l1.config.json
#    optional: L1_NAME=mychain L1_CHAIN_ID=9999 L1_TOKEN=MYL1 pnpm l1

# 2. run the app
pnpm dev    # http://localhost:3000 (or the port Next prints)
```

Then: import the printed EWOQ dev key into your wallet (pre-funded on your chain, local-only) →
**Deploy demo token** → **Mint** → watch the transactions land in the built-in explorer.

## Reset the network

```bash
avalanche network stop     # pause (keeps state)
avalanche network clean    # wipe (new blockchain ID — re-run pnpm l1)
CLEAN=1 pnpm l1            # wipe + rebuild in one step (use if a stale network blocks the deploy)
```

## What you get

- **Your own chain** — a real Subnet-EVM L1 running locally (no test AVAX, no faucet, no always-on node).
- **A built-in block explorer** — latest blocks, transactions, gas, and your balance, all read live
  from the chain's RPC with viem. No Docker, no third-party indexer.
- **Browser contract deploy** — a bundled ERC-20 you deploy and mint, so you can watch real
  transactions flow through your chain.

## Graduate to Fuji (advanced)

```bash
pnpm l1:fuji
```

Deploys the same L1 to the public Fuji testnet. This needs test AVAX and a validator node that
**stays running** (your machine can be it) — see `CLAUDE.md` for the full walkthrough and caveats.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · avalanche-cli · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` — including an explainer for every L1 config
decision (VM, consensus/sovereignty, chain ID, token, `--test-defaults`, the EWOQ warning) so Claude
Code / Cursor can walk you through building your own chain.
