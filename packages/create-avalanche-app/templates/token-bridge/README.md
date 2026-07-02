# __PROJECT_NAME__

Bridge an ERC-20 between two Avalanche L1s with **Interchain Token Transfer (ICTT)** — over a one-command local devnet. Scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit).

## Getting started

> Requires a Unix-like shell (macOS, Linux, or **WSL2** on Windows): `pnpm bridge` runs bash +
> avalanche-cli. The pure-Fuji templates work on native Windows; this one needs WSL.

```bash
# 1. spin up two L1s + a relayer + the full ICTT bridge (needs avalanche-cli)
pnpm bridge
#    → creates br1 + br2, deploys a demo ERC-20 + Home + Remote, registers them,
#      and writes bridge.config.json
#    (chains are named br1/br2 so this can run alongside the icm-messenger devnet)

# 2. run the app
pnpm dev    # http://localhost:3000 (or the port Next prints)
```

Then: import the printed EWOQ dev key into your wallet (pre-funded on both chains, local-only) →
**Mint** the demo token on br1 → **Bridge to br2** → watch the bridged token (`TOK1.b`) arrive.
Swap direction to bridge it back.

## Reset the devnet

```bash
avalanche network stop     # pause (keeps state)
avalanche network clean    # wipe (re-run pnpm bridge)
CLEAN=1 pnpm bridge        # wipe + rebuild in one step (use if a stale network blocks the deploy)
```

## How it works

- **Home** (br1) locks your ERC-20 and sends an Interchain message.
- **Remote** (br2) is itself an ERC-20 — it mints a bridged version on arrival, and burns it when
  you bridge back (which unlocks the original on br1).
- A relayer (started by `pnpm bridge`) carries the messages; a TeleporterRegistry on each chain wires
  the ICTT contracts to the ICM messenger.

The bridge contracts are compiled from [ava-labs/icm-contracts](https://github.com/ava-labs/icm-contracts)
and bundled as bytecode, so `pnpm bridge` deploys them with no Solidity toolchain on your machine.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · avalanche-cli · ICTT

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the ICTT
bridge flow (Home/Remote, lock/mint/burn/unlock, `SendTokensInput`) and the conventions.
