# create-avalanche-app

## 0.1.16

### Patch Changes

- a9a6bef: Fix social login landing on the wrong network, and silence a harmless hydration warning.

  - `@avakit/core`: `web3authAdapter` now accepts a `chains` option and configures
    Web3Auth with those chains at init (the first is the default the embedded wallet
    connects on). This makes a Google/social sign-in land directly on the app's
    chain (e.g. Fuji) instead of Web3Auth's default network, fixing the "wrong
    network — switch to this app's chain" error after signing in.
  - `create-avalanche-app`: the social-login templates pass their target chain to
    `web3authAdapter`, and every template adds `suppressHydrationWarning` to
    `<body>` to silence the hydration warning that browser wallet extensions cause
    by injecting attributes into the DOM.

## 0.1.15

### Patch Changes

- bf9f5ce: Social login now works out of the box on localhost. The social-login templates
  (minimal, nft-mint, token-gated-app, erc20-token, eerc-token) ship a bundled demo
  Web3Auth client ID, so `npm create avalanche-app` → `pnpm dev` → "Sign in with
  Google" works with zero setup — no dashboard signup or `.env.local` editing first.
  Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` before deploying (the demo key only
  allows localhost origins). The three local-devnet templates (icm-messenger,
  l1-launch, token-bridge) stay injected-only by design.

## 0.1.14

### Patch Changes

- c2b044b: Enforce the testnet-first deploy guard and make social login discoverable.

  - `@avakit/core`: `deployContract` now refuses a non-testnet (mainnet) chain
    unless you pass `confirmMainnet: true`, throwing the new
    `MainnetConfirmationError`. Fuji and other testnets are unaffected. `WalletAdapter`
    gains an optional `unavailableReason`, and `web3authAdapter` sets it when no
    client ID is configured.
  - `@avakit/react`: `useAvaDeploy().deploy(artifact, args, { confirmMainnet })`
    threads the flag through. `ConnectAvalanche` now shows an unavailable adapter
    as a disabled button with its `unavailableReason` hint instead of hiding it.
  - `create-avalanche-app`: the social-login templates always register the Web3Auth
    adapter, so "social login" is visible (disabled, with a hint to set
    `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID`) instead of silently missing before a client ID
    is configured.

- be5129e: Fix the mint flow in the nft-mint and token-gated-app templates so a successful
  mint reliably reflects in the UI. Previously `contract.write("mint", [])`
  returned the tx hash as soon as it was broadcast, and the app re-read
  `totalSupply`/`balanceOf` before the tx was mined — so the counts stayed at their
  old values and the mint looked like it did nothing. The templates now wait for
  the transaction receipt (and surface an on-chain revert) before refreshing state.
  Shipped through both the CLI (`create-avalanche-app`) and the MCP scaffold path
  (`@avakit/mcp`).

## 0.1.9

### Patch Changes

- Fix `pnpm install` failing on pnpm 11 for freshly scaffolded apps: the templates'
  `pnpm-workspace.yaml` only pre-approved `sharp`, but the default (Web3Auth) wallet
  pulls in `protobufjs` and `tiny-secp256k1`, whose unapproved build scripts made
  `pnpm install`/`pnpm dev` exit with ERR_PNPM_IGNORED_BUILDS. All eight templates now
  pre-approve those builds. Verified by a new CI smoke matrix that scaffolds, installs,
  type-checks, and builds every template.

## 0.1.8

### Patch Changes

- b78857d: Security & repo-hygiene pass:

  - create-avalanche-app: stop shipping stray Foundry build artifacts (contracts/out, cache, build-info) that had leaked into the icm-messenger template tarball; add an `.npmignore` guard so they can never ship again.
  - @avakit/studio: validate the L1 name before it reaches the Fuji key-balance filesystem path (defence-in-depth); rename the `DataView` UI component so it no longer shadows the JS global.
  - All packages: derive the reported version from package.json (single source of truth) instead of a hardcoded constant. Fixes the MCP handshake reporting a stale `0.1.0` for both `@avakit/mcp` and `@avakit/studio`.

## 0.1.7

### Patch Changes

- Add a guided "Launch on Fuji" wizard to AvaKit Studio: a 4-step flow (create + fund a key with a live C-Chain balance poller → C→P transfer → deploy a sovereign L1 to the Fuji testnet with a live progress log → live RPC + one-click add-to-wallet) that drives avalanche-cli server-side and hides its interactive prompts. Also improve the `l1-launch` template: a post-setup "next steps" card in the dashboard (add-to-wallet, faucet link, deploy-first-contract, and a keep-the-node-running + cost warning on Fuji), and a state-aware AI guide in `CLAUDE.md` so Claude Code / Cursor can walk a user through the Fuji flow step by step.

## 0.1.6

### Patch Changes

- Add the `token-bridge` template — bridge an ERC-20 between two Avalanche L1s with Interchain Token Transfer (ICTT), over a one-command local devnet (`pnpm bridge` spins up two L1s + a relayer and deploys a demo token + ERC20TokenHome + ERC20TokenRemote, registered over ICM). The bridge UI locks tokens on the home chain and mints the bridged token on the remote chain (and back). Contracts are compiled from `ava-labs/icm-contracts` with the optimizer and bundled as bytecode, so the bridge deploys with no Solidity toolchain on the user's machine. The MCP `scaffold_app` tool lists `token-bridge`.

## 0.1.5

### Patch Changes

- Add the `l1-launch` template — launch your own Avalanche L1 with one command (`pnpm l1`), then explore it in a built-in dashboard: live blocks and transactions, your balance, and a browser contract deploy, all read straight from the chain's RPC with viem (no Docker, no third-party indexer). Ships a config-decision explainer (VM, consensus/sovereignty, chain ID, token, EWOQ warning) and an advanced `pnpm l1:fuji` path to graduate the chain to the Fuji testnet. AvaKit Studio gains a matching "Launch your own L1" panel (create + deploy a single custom Subnet-EVM chain, with strict input validation) and a `devnet_launch_l1` MCP tool. The MCP `scaffold_app` tool lists `l1-launch`.

## 0.1.4

### Patch Changes

- Finish the pnpm fix for scaffolded apps on pnpm 11: the `pnpm` field in `package.json` is no longer read by pnpm 11, so approve native build scripts via a shipped `pnpm-workspace.yaml` (`allowBuilds`) instead — `sharp` for every template, plus `blake-hash`/`keccak`/`bufferutil`/`utf-8-validate` for `eerc-token`'s crypto stack. Also exempt AvaKit's own packages from pnpm's supply-chain minimum-release-age gate (`minimumReleaseAgeExclude`) so a freshly published `@avakit/*` never blocks a new app's first `pnpm install`.

## 0.1.3

### Patch Changes

- Add the `eerc-token` template — a confidential-token dapp built on Avalanche's Encrypted ERC (eERC) standard (register, private mint, confidential transfer, private burn with hidden balances), proven live on Fuji. Also fix `pnpm dev` on freshly scaffolded apps under pnpm by shipping a `pnpm-workspace.yaml` that pre-approves native build scripts (`sharp`), so the dev server starts without an `ERR_PNPM_IGNORED_BUILDS` failure. The MCP `scaffold_app` tool now lists `eerc-token` (and backfills `icm-messenger`).

## 0.1.2

### Patch Changes

- Scaffolded apps that use the social-login wallet now include `@web3auth/modal` in their dependencies, so `web3authAdapter` can actually load at runtime (previously the optional peer was never added, so choosing the Web3Auth wallet produced an app that couldn't initialize social login).

## 0.1.1

### Patch Changes

- f9c9040: Add the `icm-messenger` template: send a message between two Avalanche L1s using Interchain Messaging (ICM / Teleporter), against a one-command local devnet. Ships a send/receive `AvaKitMessenger` contract, a `scripts/devnet.sh` that spins up two local L1s with ICM + a relayer, and a UI that deploys on both chains and watches a message cross over.
