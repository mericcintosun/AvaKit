# __PROJECT_NAME__ — cross-chain token bridge with ICTT (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## What this is

A dapp that bridges an ERC-20 between two Avalanche L1s using **Interchain Token Transfer (ICTT)**.
It runs against a **local devnet** of two L1s that `scripts/bridge.sh` (`pnpm bridge`) spins up — with
Interchain Messaging, a relayer, and a full ICTT bridge (a demo token + Home + Remote) deployed and
registered automatically.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · avalanche-cli (local devnet) · ava-labs/icm-contracts (ICTT)

## How ICTT works here

- **ERC20TokenHome** (on chain1) holds the real ERC-20. When you bridge, it **locks** your tokens and
  sends an ICM message to the remote.
- **ERC20TokenRemote** (on chain2) **is itself an ERC-20** (the "bridged" token, symbol `TOK1.b`). On
  arrival it **mints** to the recipient. Bridging back **burns** the remote token and **unlocks** the
  original on the home chain.
- A **TeleporterRegistry** on each chain points the ICTT contracts at the ICM messenger predeploy
  (`0x253b…5fcf`). The relayer (started by `pnpm bridge`) carries the messages.

## Architecture

- `scripts/bridge.sh` (`pnpm bridge`) — creates + deploys two L1s, then runs `deploy-bridge.mjs`.
- `scripts/deploy-bridge.mjs` — deploys the demo ERC-20 + TeleporterRegistry + Home on chain1, a
  TeleporterRegistry + Remote on chain2, and calls `registerWithHome`. Uses viem + the embedded
  artifacts + the public EWOQ key. Writes all addresses to `bridge.config.json`.
- `lib/ictt-artifacts.json` — ABIs + bytecode for TeleporterRegistry, ERC20TokenHome,
  ERC20TokenRemote, and the demo ERC-20, compiled from `ava-labs/icm-contracts` with the optimizer.
- `lib/ictt.ts` — turns `bridge.config.json` into AvaKit chains + the addresses/ABIs the app uses.
- `components/demo.tsx` — the bridge UI: balances on both chains, mint, and bridge in either direction.

## The bridge flow (in the UI)

1. `home → remote`: `approve(home, amount)` on the demo token, then `home.send(SendTokensInput, amount)`.
   The home locks the token; the relayer delivers; the remote mints `TOK1.b` to you on chain2.
2. `remote → home`: `approve(remote, amount)` on the remote token itself, then
   `remote.send(SendTokensInput, amount)` — `ERC20TokenRemote` is an ERC-20 and `send` pulls the
   tokens via `transferFrom` before burning, so the approval is required. The relayer delivers; the
   home unlocks your original token on chain1.

`SendTokensInput` = `{ destinationBlockchainID (bytes32), destinationTokenTransferrerAddress,
recipient, primaryFeeTokenAddress, primaryFee, secondaryFee, requiredGasLimit, multiHopFallback }`.
On the local devnet, fees are 0, `primaryFeeTokenAddress` is the zero address, and
`requiredGasLimit` is 250000. `destinationBlockchainID` is the bytes32 (Avalanche) blockchain ID in
hex — NOT the EVM chainId — via `blockchainIdOf(chain)` in `lib/ictt.ts`.

## Editing / regenerating the contracts

The bundled artifacts are compiled from `ava-labs/icm-contracts` (`contracts/ictt`, non-upgradeable
variants, tag v1.0.9) with **solc 0.8.25, optimizer runs 200, and `evmVersion: cancun`** — the
optimizer keeps ERC20TokenHome/Remote under the 24 KB EVM code-size limit, and Cancun is required
because the compiled code uses the `MCOPY` opcode (building for Shanghai changes the bytecode).
To regenerate, compile those contracts with those exact settings (Hardhat or solc standard-JSON)
and replace the `abi`/`bytecode` in `lib/ictt-artifacts.json`. (Note: `avalanche interchain
tokenTransferrer deploy` can also deploy an ICTT bridge, but it requires a specific pinned Foundry
build to compile under the size limit — this template ships pre-compiled bytecode to avoid that.)

## Rules

- shadcn/ui only; `@avakit/react` components are shadcn-styled. Black & white for now; dark/light via next-themes; both must work.
- Animations: Framer Motion or GSAP only.
- Amounts are 18-decimal — always convert with `parseEther` / `formatEther`.
- Never hardcode a real private key. The EWOQ key is a PUBLIC dev key — local devnet only.

## Commands

- `pnpm bridge` — spin up the 2-L1 devnet + deploy the ICTT bridge (writes `bridge.config.json`).
  Chains are named `br1`/`br2` (chainIds 2001/2002) so this can run alongside the icm-messenger devnet.
- `CLEAN=1 pnpm bridge` — wipe any existing local network first, then rebuild (use after a reboot or
  when a stale network blocks the deploy)
- `pnpm dev` — dev server (http://localhost:3000 by default)
- `avalanche network stop | clean` — pause | wipe the local devnet
