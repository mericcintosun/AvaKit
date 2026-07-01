# __PROJECT_NAME__ — cross-chain messaging with Avalanche ICM (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## What this is

A dapp that sends a message from one Avalanche L1 to another using **Interchain
Messaging (ICM / Teleporter)**. It runs against a **local devnet** of two L1s that
`scripts/devnet.sh` spins up for you (with the TeleporterMessenger and a relayer
wired automatically).

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry (contract) · avalanche-cli (local devnet)

## Architecture

- `contracts/src/AvaKitMessenger.sol` — one contract that both **sends** (via
  `TeleporterMessenger.sendCrossChainMessage`) and **receives** (implements
  `ITeleporterReceiver.receiveTeleporterMessage`). Deploy the same contract on
  both chains.
- `lib/messenger-artifact.ts` — the compiled ABI + bytecode (browser deploy, no Foundry at runtime).
- `icm.config.json` — the two local chains (RPC URL + **hex blockchain ID**). Written by `pnpm devnet`.
- `lib/devnet.ts` — turns that config into AvaKit chains + helpers.
- `app/providers.tsx` — `<AvaKitProvider chains={[chain1, chain2]}>` with the injected wallet.
- `components/demo.tsx` — the **Devnet Studio**: live chain cards (block height + ICM status), deploy on both chains, send, and watch the message land on the other chain. When the devnet isn't up yet it shows a copy-command setup panel (`pnpm devnet`) — it never runs shell itself.
- `scripts/devnet.sh` — the one-command local ICM devnet.

## The flow

1. `pnpm devnet` — creates + deploys two L1s locally with ICM + relayer, writes `icm.config.json`.
2. Import the EWOQ dev key into your wallet (pre-funded on both chains).
3. `pnpm dev`, then in the app: deploy the messenger on chain1 and chain2.
4. Send: on the source chain, call `sendMessage(destinationBlockchainID, destinationAddress, text)`.
5. The relayer delivers it; the destination contract's `receiveTeleporterMessage` stores it. The UI polls `lastMessage()` and shows it arrive.

## The one detail that trips everyone up

`destinationBlockchainID` is the **bytes32 (Avalanche) blockchain ID in hex** — NOT
the EVM `chainId` (1001/1002). Get it from `avalanche blockchain describe <name>`
(the hex form). `lib/devnet.ts` exposes it via `blockchainIdOf(chain)`.

## Security

- The receiver **must** check `require(msg.sender == TeleporterMessenger)` — otherwise anyone can spoof a delivery. `AvaKitMessenger` does this.
- The TeleporterMessenger predeploy address (`0x253b…5fcf`) is version-pinned; on a real deployment, read it from `avalanche blockchain describe` rather than assuming.

## Editing the contract

After changing `contracts/src/AvaKitMessenger.sol`:

```bash
cd contracts && forge build
# copy out/AvaKitMessenger.sol/AvaKitMessenger.json's abi + bytecode.object into lib/messenger-artifact.ts
```

## Rules

- UI uses **shadcn/ui only** (`@avakit/react` components are shadcn-styled). Black & white; dark/light via `next-themes`.
- Animations: **Framer Motion** or **GSAP** only.
- Never hardcode private keys. The EWOQ key is a **public dev key** — local devnet only, never a real network.

## Commands

- `pnpm devnet` — start the local 2-L1 ICM devnet (writes `icm.config.json`)
- `pnpm dev` — dev server (http://localhost:3000)
- `cd contracts && forge build` — recompile the contract
- `avalanche network stop | clean` — pause | wipe the devnet
