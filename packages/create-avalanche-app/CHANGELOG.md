# create-avalanche-app

## 0.3.0

### Minor Changes

- 5ed124c: Count scaffolds anonymously, so the project can show it gets used.

  The CLI now reports which template/wallet/chain/package-manager was picked and whether the scaffold worked, plus a random per-machine id. It never sends project names, paths, code, env vars, or error text, and no IP is stored. It announces itself on the first run and is off via `--no-telemetry`, `AVAKIT_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, or automatically in CI. It cannot fail or slow down a scaffold — worst case it gives up after 1.5 seconds.

## 0.2.0

### Minor Changes

- 6e14b14: Zero-config onboarding: kill the wallet + funding barriers on first run.

  - **@avakit/core:** new `burnerAdapter()` / `clearBurner()` — a zero-config, in-browser temporary wallet (persisted to localStorage) exposed as a standard EIP-1193 provider, so a new user can transact with no extension, dashboard, or client ID. New `@avakit/core/coinbase` subpath with `coinbaseAdapter()` (Coinbase Smart Wallet passkey / ERC-4337, no dashboard). New `requestFaucet()` helper to auto-fund an address from an AvaKit-hosted faucet.
  - **@avakit/react:** `ConnectAvalanche` now leads with a "start instantly" temporary wallet and offers real wallets as the "already have a wallet?" upgrade. New `useFaucet()` hook, an optional `faucetUrl` on `AvaKitProvider` that auto-funds a burner on connect, and an optional `autoConnect="burner"` that connects a temporary wallet when no injected wallet is present.
  - **create-avalanche-app:** every template wires the burner wallet by default. `AVAKIT_DEP_VERSION` now lives in `./api` as a single source of truth shared by the CLI and `@avakit/mcp`, so both scaffolding paths pin the same `@avakit/*` version (fixes MCP-scaffolded apps getting `^0.1.0`).
  - **@avakit/mcp:** inherits the shared dep-version pin via the scaffolder default.

## 0.1.21

### Patch Changes

- 59c28ee: `create-avalanche-app`: the Ink wizard now shows a review/confirm step before
  scaffolding (Enter to accept); the `erc20-token` template waits for the tx receipt
  before re-reading balances (so mint/transfer results show reliably); and scaffolded
  apps now pin `@avakit/*` at `^0.1.6`, so the `web3authAdapter({ chains })` option
  always resolves (older resolutions could fail to typecheck).

  `@avakit/mcp`: new `estimate_gas` tool — estimate the gas a transaction would use,
  plus the current gas price and a rough AVAX cost, over RPC (no key needed).

## 0.1.20

### Patch Changes

- bbc240a: `create-avalanche-app`: after scaffolding, the wizard offers to start the dev
  server for you (`Start the dev server now?`), so you don't have to `cd` + run it
  by hand. Only shown for dev-able templates once dependencies are installed;
  declining just prints the next steps as before.

  `@avakit/studio`: the startup output is now a crimson-bordered panel showing the
  dashboard URL, matching the CLI banner's look.

## 0.1.19

### Patch Changes

- e2d9841: Rebuild the interactive CLI as a real terminal app with Ink (React for the
  terminal). Running `npm create avalanche-app` now renders a bordered,
  Ember-Crimson panel: the ASCII AvaKit banner, a step-by-step wizard with
  brand-colored selection, live scaffolding/install progress, and a framed success
  summary with next steps and links. Non-interactive runs (`--yes`, CI, pipes) stay
  plain and scriptable. Templates are also shown in a curated order (starters first).

## 0.1.18

### Patch Changes

- 747ece8: Make the `create-avalanche-app` CLI feel like a product. The prompts are now one
  cohesive `group` with a single cancel handler (and any answer passed as a flag
  skips its prompt); scaffolding and install run as a ticked-off task list;
  wallet/network labels are cleaner; and the run ends with a linked summary. The
  off-brand cyan intro pill is replaced by a branded header under the ASCII banner.

## 0.1.17

### Patch Changes

- 7d493d9: Add an AvaKit brand banner to every terminal session — an ASCII mountain (snow
  cap) above a block-letter AVAKIT wordmark in an Ember Crimson gradient. Printed on
  startup by `create-avalanche-app`, `@avakit/mcp`, and `@avakit/studio`. It's raw
  ANSI with no dependencies; color auto-disables on a non-TTY / when `NO_COLOR` is
  set, and the MCP servers write it to stderr so the JSON-RPC channel stays clean.
  `@avakit/studio`'s dashboard also gains a one-time terminal-style boot splash.

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
