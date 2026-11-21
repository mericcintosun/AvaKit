# __PROJECT_NAME__

Bridge an ERC-20 between two Avalanche L1s with **Interchain Token Transfer (ICTT)** — over a one-command local devnet. Scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit).

> **Experimental.** This template depends on Avalanche CLI, which has been in maintenance mode
> since December 2025, and it was last proven end to end in July 2026. `create-avalanche-app`
> labels it experimental and warns when you choose it. See [Tooling status](#tooling-status).

## Getting started

> Requires a Unix-like shell (macOS, Linux, or **WSL2** on Windows): `npm run bridge` runs bash +
> avalanche-cli. The pure-Fuji templates work on native Windows; this one needs WSL.

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. spin up two L1s + a relayer + the full ICTT bridge (needs avalanche-cli)
npm run bridge
#    → creates br1 + br2, deploys a demo ERC-20 + Home + Remote, registers them,
#      and writes bridge.config.json
#    (chains are named br1/br2 so this can run alongside the icm-messenger devnet)

# 2. run the app
npm run dev    # http://localhost:3000 (or the port Next prints)
```

Then: import the printed EWOQ dev key into your wallet (pre-funded on both chains, local-only) →
**Mint** the demo token on br1 → **Bridge to br2** → watch the bridged token (`TOK1.b`) arrive.
Swap direction to bridge it back.

## Tooling status

`npm run bridge` (`scripts/bridge.sh`, `scripts/deploy-bridge.mjs`) drives **Avalanche CLI** (the
`avalanche` command, from [ava-labs/avalanche-cli](https://github.com/ava-labs/avalanche-cli)). What to know
before you rely on it:

- Ava Labs put Avalanche CLI in maintenance mode in December 2025, and on 2026-10-06 removed its
  pages from the Avalanche documentation in favour of Platform CLI.
- This template was last proven end to end in July 2026, with Avalanche CLI 1.9.6 (check yours
  with `avalanche --version`). Both scripts have been changed since then, and the changed versions
  have not been through a full run on a live network yet. They read what
  `avalanche blockchain describe` prints, so another CLI version may need adjustments.
- Moving this template to the supported toolchain is planned work and is not done yet.

## Reset the devnet

```bash
avalanche network stop     # pause (keeps state)
avalanche network clean    # wipe (re-run npm run bridge)
CLEAN=1 npm run bridge     # wipe + rebuild in one step (use if a stale network blocks the deploy)
```

## How it works

- **Home** (br1) locks your ERC-20 and sends an Interchain message.
- **Remote** (br2) is itself an ERC-20 — it mints a bridged version on arrival, and burns it when
  you bridge back (which unlocks the original on br1).
- A relayer (started by `npm run bridge`) carries the messages; a TeleporterRegistry on each chain wires
  the ICTT contracts to the ICM messenger.

The bridge contracts are compiled from [ava-labs/icm-contracts](https://github.com/ava-labs/icm-contracts)
and bundled as bytecode, so `npm run bridge` deploys them with no Solidity toolchain on your machine.
The demo ERC-20 it deploys next to them is AvaKit's own `AvaKitToken` (the `erc20-token`
template's contract), bundled the same way.

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · avalanche-cli · ICTT

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the ICTT
bridge flow (Home/Remote, lock/mint/burn/unlock, `SendTokensInput`) and the conventions.
