# __PROJECT_NAME__ — Launch your own Avalanche L1 (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## What this is

A one-command flow that spins up **your own Avalanche L1** (a Subnet-EVM blockchain) on a local
Avalanche network, then hands you a **built-in block explorer + dashboard**: live blocks and
transactions, your balance, and a "deploy a contract" button — all reading straight from your
chain's RPC, no third-party explorer or Docker required. `npm run l1:fuji` launches a sovereign version
of the same chain on the public Fuji testnet (advanced).

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (demo contract) · avalanche-cli (the L1)

## Tooling status

- The local network is driven by **Avalanche CLI** (`avalanche`, ava-labs/avalanche-cli). Ava Labs
  put it in maintenance mode in December 2025 and removed its pages from the Avalanche
  documentation on 2026-10-06 in favour of Platform CLI.
- Last proven end to end: July 2026, with Avalanche CLI 1.9.6. `scripts/l1.sh` and
  `scripts/l1-fuji.sh` have been changed since then, and the changed versions have not been through a
  full run on a live network yet.
- Migration to the supported toolchain is planned work, not done. Until then do not replace the
  `avalanche …` commands with another tool's: the scripts parse what
  `avalanche blockchain describe` prints (the RPC URL, the hex blockchain ID and the EWOQ row).
  If a step fails, compare `avalanche --version` with 1.9.6 first and show the user what the CLI
  printed.

## Architecture

- `scripts/l1.sh` (`npm run l1`) — creates + deploys a local Subnet-EVM L1 and writes `l1.config.json`.
- `scripts/l1-fuji.sh` (`npm run l1:fuji`) — the advanced path: create a separate sovereign
  Proof-of-Authority config for your chain (`<name>fuji`) and deploy that to Fuji. It never deploys
  the local dev config and never overwrites an existing one.
- `l1.config.json` — your chain: `name`, `token`, `evmChainId`, `rpcUrl`, `blockchainIdHex`, and (local only) the pre-funded `faucetAccount`. Written by the scripts.
- `lib/l1.ts` — turns that config into an AvaKit chain (`defineChain`) + `isConfigured`.
- `lib/deployed-contract.ts` — `useDeployedContract(name, chain)`: remembers the deployed demo token
  in `localStorage`, keyed by chain id **and RPC URL**, and only hands the address to the UI after
  `eth_getCode` confirms bytecode. After a network reset (or a switch to Fuji) the old address is
  dropped and the card goes back to "Deploy demo token". Never read a contract address straight
  from `localStorage`.
- `components/demo.tsx` — the dashboard/explorer: polls the RPC for height, gas, the latest blocks and their transactions; deploys the demo ERC-20; mints.
- `contracts/src/AvaKitToken.sol` + `lib/token-artifact.ts` — a minimal self-contained ERC-20 (browser deploy, no Foundry at runtime).
- `app/providers.tsx` — `<AvaKitProvider chains={[chain]}>` with the injected wallet.

## The flow

1. `npm run l1` — creates the L1, deploys it locally, writes `l1.config.json`.
2. Import the printed EWOQ dev key into your wallet (pre-funded on your chain — public, local only).
3. `npm run dev` → the page becomes your chain dashboard.
4. Deploy the demo token → mint → watch the transactions land in the built-in explorer live.

## The config decisions (explain these to the user when asked)

`npm run l1` runs `avalanche blockchain create` with these choices — each is a real design decision:

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
  The Fuji path (`npm run l1:fuji`) uses a sovereign PoA L1 owned by your Fuji key. Because the local
  config is non-sovereign, the script creates a **second** avalanche-cli config for Fuji (named
  `<name>fuji`, same chain ID and token) rather than deploying the local one.
- **`--test-defaults`**: dev-friendly genesis — the **EWOQ** key is pre-funded, fees are low, finality
  is fast. Its opposite is `--production-defaults`, which is what the Fuji config uses: no EWOQ
  allocation, the owner address pre-funded instead. Never ship `--test-defaults` economics to a
  public network: whoever holds the public EWOQ key would own the genesis supply.

## EWOQ warning

`0x56289e…8027` (address `0x8db97C…52FC`) is avalanche-cli's **public** local dev key, pre-funded on
every local chain. It is **local-only** — never use it, or its balance, on Fuji or mainnet, and never
commit a real private key. On Fuji you bring your own funded wallet.

## Graduating to Fuji (advanced)

`FUJI_KEY=<key> npm run l1:fuji` puts your chain on the public Fuji testnet. Unlike the local flow this
needs, and the script will walk you through: (1) a Fuji key funded with test AVAX (the official
faucet, which needs a free Builder Hub sign-in → C-Chain → cross-chain transfer to the P-Chain),
(2) a **bootstrap validator** — your machine can be it (`--use-local-machine`), but that process
must **stay running** or the L1 stops producing blocks, (3) an ongoing validator **balance** that
drains over time (~1 AVAX ≈ 1 month) and must be topped up.
It is a multi-minute process with CLI prompts along the way. There is no automatic hosted explorer for
a custom Fuji L1 — this app's built-in explorer keeps working by pointing at your Fuji L1's RPC.

What the script does, in order:

1. Reads the chain ID and token from `l1.config.json` (override with `L1_CHAIN_ID` / `L1_TOKEN`) and
   picks the Fuji config name: `L1_FUJI_NAME`, else `<L1_NAME>fuji`, else `<name in l1.config.json>fuji`.
2. Looks at avalanche-cli's own record of that name (`~/.avalanche-cli/subnets/<name>/sidecar.json`):
   - no config → creates one: sovereign, `--proof-of-authority`, `--production-defaults`, owned by
     the Fuji key's address (or `L1_OWNER`);
   - a local dev config (`"Sovereign": false`, or EWOQ in the genesis) → **refuses**;
   - a sovereign config that is not on Fuji yet → uses it as is;
   - already on Fuji → skips the deploy.
3. Deploys with `--fuji --use-local-machine --num-bootstrap-validators 1 --balance 0.1 --vmc-L1`
   (`L1_VALIDATOR_BALANCE` changes the balance).
4. Rewrites `l1.config.json` (`network: "fuji"`, the Fuji RPC, the hex blockchain ID).

It is safe to re-run: it never passes `--force`, so it cannot erase a config. `npm run l1` points the app
back at the local chain and `npm run l1:fuji` back at the Fuji one.

**Gas on the Fuji L1** is the L1's own token, not AVAX — the Fuji faucet does not help here. With
`--production-defaults` the owner address (your Fuji key) starts with native tokens, and avalanche-cli
generates a funded `subnet_<name>_airdrop` key. Import one into the wallet
(`avalanche key export <key name>` prints it — treat a Fuji key like any real key).

## AI guide: state-aware Fuji walkthrough

When the user asks for help getting their L1 onto Fuji, first figure out WHERE they are, then give
the ONE next command. `<key>` is their avalanche-cli key name and `<fuji>` the Fuji config name
(`<name>fuji` by default — see above). Steps 3–5 are what `FUJI_KEY=<key> npm run l1:fuji` does for
them; the individual commands are here so you can detect state or drive it by hand. Detect state like
this:

1. **Do they have a funded key?** Run `avalanche key list --fuji --keys <key>` (or create one:
   `avalanche key create <key>`). Check the key's **C-Chain** balance — if it's 0, the next step is
   the official faucet, which needs a free Builder Hub sign-in: send them to
   `https://build.avax.network/console/primary-network/faucet` for their key's C-Chain address,
   and wait until the balance is non-zero. Budget ~1–2 test AVAX (validators pay a
   continuous P-Chain fee, ~1 AVAX ≈ 1 month).
2. **Is the balance on the P-Chain?** The L1 deploy spends from the **P-Chain**, but the faucet funds
   the **C-Chain**. If P-Chain balance is 0, next command:
   `avalanche key transfer --key <key> --fuji --c-chain-sender --p-chain-receiver --amount <x>`
   (the C/P selectors are the boolean flags `--c-chain-sender` / `--p-chain-receiver`, NOT
   `--sender-blockchain c`; leave a little on the C-Chain for the transfer fee).
3. **Is there a sovereign config to deploy?** Read `~/.avalanche-cli/subnets/<fuji>/sidecar.json`.
   If it doesn't exist, create it:
   `avalanche blockchain create <fuji> --evm --latest --evm-chain-id <id> --evm-token <TOK>
   --proof-of-authority --validator-manager-owner <keyAddr> --proxy-contract-owner <keyAddr>
   --production-defaults` (`<keyAddr>` is the key's C-Chain address from step 1).
   If it exists with `"Sovereign": false` it is a local dev config from `npm run l1` (EWOQ-funded
   genesis): **never deploy that one to Fuji** and do not overwrite it with `--force` — use a
   different name for the Fuji config.
4. **Deploy to Fuji.** `avalanche blockchain deploy <fuji> --fuji --key <key> --use-local-machine
   --num-bootstrap-validators 1 --balance 0.1 --vmc-L1`. Notes for driving this non-interactively:
   `--vmc-L1` pre-answers the "deploy Validator Manager into an external blockchain?" prompt; the final
   "fund the relayer?" prompt is optional and can be skipped (the L1 still deploys — the relayer only
   matters for cross-chain messaging). If it complains a **local deploy already exists**, a previous
   Fuji attempt for that name left a node cluster behind — answer the overwrite prompt, or pick a
   fresh name, and retry. The node bootstraps to Fuji first (downloads a multi-hundred-MB archive, a
   few minutes) — that wait is normal, not a hang.
5. **Verify it's live.** `Networks.Fuji.RPCEndpoints` in the sidecar now holds the RPC (the deploy
   also prints it as `RPC Endpoint`). Re-run `FUJI_KEY=<key> npm run l1:fuji` to point this app at it —
   or set `l1.config.json` → `network: "fuji"`, `name`, `rpcUrl`, `blockchainIdHex` by hand. Confirm:
   `cast chain-id --rpc-url <rpc>` returns the chain id, `cast block-number` advances after a
   transaction (Subnet-EVM produces no empty blocks), and the blockchain is listed on Fuji's P-Chain
   via `platform.getBlockchains` on `https://api.avax-test.network/ext/bc/P`.
6. **Remind them of the ongoing cost:** the validator node must stay running, and its balance drains —
   check it with `avalanche validator getBalance --fuji --l1 <fuji>` and top it up with
   `avalanche validator increaseBalance --fuji --l1 <fuji> --key <key> --balance <avax>`, or the L1
   goes inactive (0.1 AVAX lasts about three days). For an always-on chain, run the node on a
   server, not a laptop.

Also available with the visual version of this flow: **AvaKit Studio** (`npx @avakit/studio`) has a
"Launch on Fuji" wizard that runs these exact steps with a balance poller and a live progress log.

## Editing the demo contract

After changing `contracts/src/AvaKitToken.sol`: `cd contracts && forge build`, then copy
`out/AvaKitToken.sol/AvaKitToken.json`'s `abi` + `bytecode.object` into `lib/token-artifact.ts`.

## Rules

- shadcn/ui only; `@avakit/react` components are shadcn-styled. Black & white for now; dark/light via next-themes; both must work.
- Animations: Framer Motion or GSAP only.
- The explorer is all read-only viem (`getPublicClient(chain)` → `getBlock`/`getBalance`/…); keep it that way — no server, no indexer.
- Never hardcode a real private key. The EWOQ key is public/local-only, and even it is not written
  into this repo: `npm run l1` reads it from `avalanche blockchain describe` to print it, so secret
  scanners stay quiet.

## Commands

- `npm run l1` — launch your local L1 (writes `l1.config.json`)
- `CLEAN=1 npm run l1` — wipe any existing local network first, then rebuild (use after a reboot or when
  a stale network blocks the deploy)
- `npm run dev` — dev server (http://localhost:3000 by default)
- `FUJI_KEY=<key> npm run l1:fuji` — launch a sovereign PoA version of the chain on Fuji (advanced;
  safe to re-run)
- `avalanche network stop | clean` — pause | wipe the local network
- `cd contracts && forge build` — recompile the demo token
