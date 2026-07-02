# __PROJECT_NAME__

Bridge an ERC-20 between two Avalanche L1s with **Interchain Token Transfer (ICTT)** — over a one-command local devnet. Scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit).

## Getting started

```bash
# 1. spin up two L1s + a relayer + the full ICTT bridge (needs avalanche-cli)
pnpm bridge
#    → creates chain1 + chain2, deploys a demo ERC-20 + Home + Remote, registers them,
#      and writes bridge.config.json

# 2. run the app
pnpm dev    # http://localhost:3000
```

Then: import the printed EWOQ dev key into your wallet (pre-funded on both chains, local-only) →
**Mint** the demo token on chain1 → **Bridge to chain2** → watch the bridged token (`TOK1.b`) arrive.
Swap direction to bridge it back.

## How it works

- **Home** (chain1) locks your ERC-20 and sends an Interchain message.
- **Remote** (chain2) is itself an ERC-20 — it mints a bridged version on arrival, and burns it when
  you bridge back (which unlocks the original on chain1).
- A relayer (started by `pnpm bridge`) carries the messages; a TeleporterRegistry on each chain wires
  the ICTT contracts to the ICM messenger.

The bridge contracts are compiled from [ava-labs/icm-contracts](https://github.com/ava-labs/icm-contracts)
and bundled as bytecode, so `pnpm bridge` deploys them with no Solidity toolchain on your machine.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · avalanche-cli · ICTT

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the ICTT
bridge flow (Home/Remote, lock/mint/burn/unlock, `SendTokensInput`) and the conventions.
