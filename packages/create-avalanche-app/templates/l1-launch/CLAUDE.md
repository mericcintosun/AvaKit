# __PROJECT_NAME__ — Launch your own Avalanche L1 (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## What this is

A one-command flow that spins up **your own Avalanche L1** (a Subnet-EVM blockchain) on a local
Avalanche network, then hands you a **built-in block explorer + dashboard**: live blocks and
transactions, your balance, and a "deploy a contract" button — all reading straight from your
chain's RPC, no third-party explorer or Docker required. `pnpm l1:fuji` graduates the same chain to
the public Fuji testnet (advanced).

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (demo contract) · avalanche-cli (the L1)

## Architecture

- `scripts/l1.sh` (`pnpm l1`) — creates + deploys a local Subnet-EVM L1 and writes `l1.config.json`.
- `scripts/l1-fuji.sh` (`pnpm l1:fuji`) — the advanced path: deploy the L1 to Fuji.
- `l1.config.json` — your chain: `name`, `token`, `evmChainId`, `rpcUrl`, `blockchainIdHex`, and (local only) the pre-funded `faucetAccount`. Written by the scripts.
- `lib/l1.ts` — turns that config into an AvaKit chain (`defineChain`) + `isConfigured`.
- `components/demo.tsx` — the dashboard/explorer: polls the RPC for height, gas, the latest blocks and their transactions; deploys the demo ERC-20; mints.
- `contracts/src/AvaKitToken.sol` + `lib/token-artifact.ts` — a minimal self-contained ERC-20 (browser deploy, no Foundry at runtime).
- `app/providers.tsx` — `<AvaKitProvider chains={[chain]}>` with the injected wallet.

## The flow

1. `pnpm l1` — creates the L1, deploys it locally, writes `l1.config.json`.
2. Import the printed EWOQ dev key into your wallet (pre-funded on your chain — public, local only).
3. `pnpm dev` → the page becomes your chain dashboard.
4. Deploy the demo token → mint → watch the transactions land in the built-in explorer live.

## The config decisions (explain these to the user when asked)

`pnpm l1` runs `avalanche blockchain create` with these choices — each is a real design decision:

- **VM = Subnet-EVM** (`--evm --latest`): an EVM chain, so Solidity/viem/MetaMask all work. The
  alternative is a custom VM (`--custom`) — only needed for non-EVM execution.
- **Chain ID** (`--evm-chain-id`, default `9999`): the EVM chain id wallets use. Pick something that
  won't collide with a chain your users already have (see chainlist.org). It's baked into the
  genesis — changing it later means a new chain.
- **Native token** (`--evm-token`, default `MYL1`): the gas/native currency symbol. Purely cosmetic
  on a dev chain; on a real L1 it's your chain's economic unit.
- **Consensus / sovereignty**: this template uses `--sovereign=false` (a non-sovereign subnet) for
  the **local** chain because it's fully non-interactive and instant. A true **sovereign L1**
  (post-Etna, the modern default) has its validator set managed by a **Validator Manager** contract
  and picks a validator-management model:
  - **PoA** (`--proof-of-authority`): you (an owner address) add/remove validators. Simplest; good
    for a consortium or a chain you run.
  - **PoS native** (`--proof-of-stake-native`): validators stake the native token.
  - **PoS ERC-20** (`--proof-of-stake-erc20`): validators stake a specified ERC-20.
  The Fuji path (`pnpm l1:fuji`) uses a sovereign PoA L1.
- **`--test-defaults`**: dev-friendly genesis — the **EWOQ** key is pre-funded, fees are low, finality
  is fast. Its opposite is `--production-defaults`. Never ship `--test-defaults` economics to mainnet.

## EWOQ warning

`0x56289e…8027` (address `0x8db97C…52FC`) is avalanche-cli's **public** local dev key, pre-funded on
every local chain. It is **local-only** — never use it, or its balance, on Fuji or mainnet, and never
commit a real private key. On Fuji you bring your own funded wallet.

## Graduating to Fuji (advanced)

`pnpm l1:fuji` deploys the L1 to the public Fuji testnet. Unlike the local flow this needs, and the
script will walk you through: (1) a Fuji key funded with test AVAX (Builder Hub faucet → C-Chain →
cross-chain transfer to the P-Chain), (2) a **bootstrap validator** — your machine can be it
(`--use-local-machine`), but that process must **stay running** or the L1 stops producing blocks,
(3) an ongoing validator **balance** that drains over time (~1 AVAX ≈ 1 month) and must be topped up.
It is a multi-step, multi-minute process, not one command. There is no automatic hosted explorer for
a custom Fuji L1 — this app's built-in explorer keeps working by pointing at your Fuji L1's RPC.

## Editing the demo contract

After changing `contracts/src/AvaKitToken.sol`: `cd contracts && forge build`, then copy
`out/AvaKitToken.sol/AvaKitToken.json`'s `abi` + `bytecode.object` into `lib/token-artifact.ts`.

## Rules

- shadcn/ui only; `@avakit/react` components are shadcn-styled. Black & white for now; dark/light via next-themes; both must work.
- Animations: Framer Motion or GSAP only.
- The explorer is all read-only viem (`getPublicClient(chain)` → `getBlock`/`getBalance`/…); keep it that way — no server, no indexer.
- Never hardcode a real private key. The EWOQ key is public/local-only.

## Commands

- `pnpm l1` — launch your local L1 (writes `l1.config.json`)
- `pnpm dev` — dev server (http://localhost:3000)
- `pnpm l1:fuji` — deploy the L1 to Fuji (advanced)
- `avalanche network stop | clean` — pause | wipe the local network
- `cd contracts && forge build` — recompile the demo token
