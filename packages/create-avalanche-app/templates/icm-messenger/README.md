# __PROJECT_NAME__

An Avalanche **cross-chain messaging** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Send a string from one Avalanche L1 to another using **Interchain Messaging (ICM / Teleporter)** — against a local devnet you bring up with one command.

## Getting started

```bash
# 1. start two local L1s with ICM + a relayer (writes icm.config.json)
pnpm devnet

# 2. run the app
pnpm dev    # http://localhost:3000
```

`pnpm devnet` needs [avalanche-cli](https://build.avax.network/docs/tooling/avalanche-cli/get-avalanche-cli) and a Unix-like shell (macOS, Linux, or **WSL2** on Windows — the script is bash):

```bash
curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin
```

The two local chains are named `icm1`/`icm2` (EVM chainIds 1001/1002), so this can run alongside the token-bridge devnet without colliding.

Then in your wallet (Core / MetaMask), **import the EWOQ dev key** (pre-funded on both local chains — public dev key, never use on a real network):

```
0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
```

## The flow

1. **Deploy the messenger** on both chains — `icm1` and `icm2` (one click each — deploys from your browser).
2. **Send** a message from one chain to the other.
3. The relayer delivers it; the destination contract stores it. The app polls and shows it **arrive** on the other L1.

## How it works

- `contracts/src/AvaKitMessenger.sol` — one self-contained contract that both **sends** (`TeleporterMessenger.sendCrossChainMessage`) and **receives** (`ITeleporterReceiver.receiveTeleporterMessage`). Deployed on both chains.
- `scripts/devnet.sh` — creates two subnet-EVM L1s, deploys them locally, and lets avalanche-cli wire the TeleporterMessenger + relayer automatically. It then writes each chain's RPC URL and **hex blockchain ID** into `icm.config.json`.
- `lib/devnet.ts` — turns that config into AvaKit chains and exposes `blockchainIdOf(chain)`.

> **Gotcha:** ICM routes by the **bytes32 blockchain ID** (hex), not the EVM `chainId`. This template handles that for you — see `lib/devnet.ts`.

To change the contract:

```bash
cd contracts && forge build
# copy out/AvaKitMessenger.sol/AvaKitMessenger.json (abi + bytecode.object) into lib/messenger-artifact.ts
```

## Reset the devnet

```bash
avalanche network stop     # pause (keeps state)
avalanche network clean    # wipe (new blockchain IDs — re-run pnpm devnet)
CLEAN=1 pnpm devnet        # wipe + rebuild in one step (use if a stale network blocks the deploy)
```

## Stack

Next.js 16 · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry · avalanche-cli

MIT
