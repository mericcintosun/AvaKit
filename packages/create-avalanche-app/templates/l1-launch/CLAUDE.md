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

## AI guide: state-aware Fuji walkthrough

When the user asks for help getting their L1 onto Fuji, first figure out WHERE they are, then give
the ONE next command. Detect state like this:

1. **Do they have a funded key?** Run `avalanche key list --keys <name>` (or create one:
   `avalanche key create <name>`). Check the key's **C-Chain** balance — if it's 0, the next step is
   the faucet: send them to `https://build.avax.network/console/primary-network/faucet` for their key's
   C-Chain address, and wait until the balance is non-zero. Budget ~1–2 test AVAX (validators pay a
   continuous P-Chain fee, ~1 AVAX ≈ 1 month).
2. **Is the balance on the P-Chain?** The L1 deploy spends from the **P-Chain**, but the faucet funds
   the **C-Chain**. If P-Chain balance is 0, next command:
   `avalanche key transfer --key <name> --fuji --c-chain-sender --p-chain-receiver --amount <x>`
   (the C/P selectors are the boolean flags `--c-chain-sender` / `--p-chain-receiver`, NOT
   `--sender-blockchain c`).
3. **Is the blockchain config created?** If `~/.avalanche-cli/subnets/<name>` doesn't exist, create it:
   `avalanche blockchain create <name> --evm --latest --evm-chain-id <id> --evm-token <TOK>
   --proof-of-authority --validator-manager-owner <yourAddr> --proxy-contract-owner <yourAddr>
   --production-defaults --force`.
4. **Deploy to Fuji.** `avalanche blockchain deploy <name> --fuji --key <name> --use-local-machine
   --num-bootstrap-validators 1 --balance 0.1 --vmc-L1`. Notes for driving this non-interactively:
   `--vmc-L1` pre-answers the "deploy Validator Manager into an external blockchain?" prompt; the final
   "fund the relayer?" prompt is optional and can be skipped (the L1 still deploys — the relayer only
   matters for cross-chain messaging). If it complains a **local deploy already exists**, the machine
   has stale state — `avalanche network clean` (or pick a fresh `<name>`) and retry. The node
   bootstraps to Fuji first (downloads a multi-hundred-MB archive, a few minutes) — that wait is
   normal, not a hang.
5. **Verify it's live.** The deploy prints an `RPC Endpoint`. Point this app at it (set
   `l1.config.json` → `network: "fuji"`, `rpcUrl`, `blockchainIdHex`). Confirm: `cast chain-id
   --rpc-url <rpc>` returns your chain id, `cast block-number` advances, and the blockchain is listed
   on Fuji's P-Chain via `platform.getBlockchains` on `https://api.avax-test.network/ext/bc/P`.
6. **Remind them of the ongoing cost:** the validator node must stay running, and its balance drains —
   top it up (`avalanche blockchain addValidator` / increase-balance) or the L1 goes inactive. For an
   always-on chain, run the node on a server, not a laptop.

Also available with the visual version of this flow: **AvaKit Studio** (`npx @avakit/studio`) has a
"Launch on Fuji" wizard that runs these exact steps with a balance poller and a live progress log.

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
