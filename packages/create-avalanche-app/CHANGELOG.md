# create-avalanche-app

## 0.5.0

### Minor Changes

- 0dad431: The three templates that need Avalanche CLI (`icm-messenger`, `l1-launch` and `token-bridge`) are now marked experimental in their manifests: the wizard labels them in the list and warns once one is chosen, a non-interactive `--template` run prints the same warning before it scaffolds, `--help` names them, `listTemplates()` reports every template's `status`, and the MCP server's `list_templates` shows it too, because the server ships this scaffolder.

### Patch Changes

- 2398655: The eerc-token template is pinned to the 2026-08-31 security fixes of `ava-labs/EncryptedERC`, so `npm run deploy:eerc`, which at the old pin stopped at its compile step on a clean machine and would otherwise have deployed verifiers that reject every proof the app makes and accept forged ones, now deploys an instance the app can register, mint, transfer and burn on, and new apps start on a shared Fuji instance deployed the same way (`@avakit/mcp` is released with it because the server pins the scaffolder it ships).
- 485ca7b: The status dots in the `icm-messenger`, `l1-launch` and `token-bridge` apps no longer pulse with CSS animations, in line with AvaKit's rule that animations use Framer Motion or GSAP and that `tw-animate-css` is only for shadcn/ui's own enter and exit animations, which those apps' CLAUDE.md now spells out for coding agents.
- 5657374: The token-bridge template's bridge contracts (`ERC20TokenHome`, `ERC20TokenRemote` and `TeleporterRegistry` in `lib/ictt-artifacts.json`) are now the build of `ava-labs/icm-contracts` v1.0.9 that the AvaKit repository repeats and compares byte for byte on every change, with the same code and ABI as before and only the metadata hash at the end of each bytecode changed; `@avakit/mcp` is released with it because the server pins the scaffolder it ships.

## 0.4.3

### Patch Changes

- 8e2ed22: Scaffolded apps now install with npm 10, the npm that ships with Node.js 22. The social login SDK they all include (`@web3auth/modal`) lists vitest among its runtime dependencies, and the peer dependencies that brings in made npm 10 stop with "Cannot read properties of null (reading 'edgesOut')". Every app now has an `.npmrc` with `legacy-peer-deps=true`; it lists every peer it needs as a dependency of its own, so nothing is lost. `@avakit/mcp` is released with it, because the server pins the scaffolder it ships.

## 0.4.2

### Patch Changes

- 431c3c9: The CLI now installs with the package manager you launched it with (falling back to
  npm), and when that manager is missing or the install fails it says so, prints the
  commands to run by hand and exits non-zero instead of printing "Done". Unknown flags,
  templates, chains and package managers are rejected with the list of valid values
  rather than silently replaced, each template can only be scaffolded for the chains its
  manifest lists (only `minimal` supports `c-chain`), and a hand-written telemetry
  opt-out is no longer overwritten.

  On Windows the package manager is started through a shell, as the `.cmd` shims of npm,
  pnpm and yarn require. A scaffold that fails part-way removes what it wrote instead of
  blocking the retry, and build output or local `.env` files left inside a template
  directory are no longer copied into the new app.

- 7eb0ec4: Harden the contracts the templates ship: the NFT keeps its on-chain art when it
  is transferred, names the network it is actually deployed on and reverts
  `balanceOf` for the zero address and `getApproved` for a missing token as
  ERC-721 requires, while the ICM messenger rejects a zero origin sender from an
  unregistered chain and caps messages at 256 bytes so a delivery always fits its
  gas budget. Each template's `foundry.toml` now pins the EVM version (`cancun`)
  beside solc, so `forge build` reproduces the bundled bytecode byte for byte.
- 34ff1b4: Scaffolded apps start on current dependency versions: every template now pins Next.js 16.4.6, React 19.3.1, viem 2.58.0, Tailwind CSS 4.3.5, lucide-react 1.74.0 and `@web3auth/modal` 11.4.3, all within the major versions they were already on. The packages' own dependencies move to the same versions: `@avakit/core` depends on viem 2.58.0, `@avakit/react` on `@radix-ui/react-dialog` 1.3.1, lucide-react 1.74.0 and tailwind-merge 3.7.0, `@avakit/mcp` and `@avakit/studio` on `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7 and viem 2.58.0, and the scaffolder itself on Ink 7.1.1 and React 19.3.1.
- 40c8fc5: The CLI now needs Node.js 22 or newer (`engines.node` is `>=22`). The library that draws the
  interactive wizard already required Node.js 22, so on Node.js 20 or 21 npm warned about it and
  stricter installers refused the CLI; such a Node.js now gets one line that names the version it
  found and the one it needs, and nothing is created.

  Pressing Ctrl+C at a wizard prompt now exits with status 130 instead of 0, after one line that
  says whether anything was created, so a command chained with `&&` stops. Answering No to
  "Create the app now?" still exits with 0 and now says "Nothing was created."

- f71bacd: Tokens minted from the `nft-mint` and `token-gated-app` templates no longer
  claim to have been minted at avakit.dev/new with no install and no gas: the
  on-chain description now reads "Generated on-chain by the AvaKitNFT contract.
  The art is derived from the token and never changes.", which holds wherever
  the contract is deployed. The demo token the `token-bridge` template deploys is
  rebuilt from the `erc20-token` contract with the pinned compiler settings (its
  behaviour is unchanged; only the metadata hash at the end of the bytecode
  differs).
- d8cdb7e: Every command a scaffolded app shows is now written for npm (`npm install`, `npm run dev`, `npm run devnet`, `npm run l1`, `npm run bridge`, `npm run deploy:eerc`), so it works on a machine with only Node.js; pnpm, yarn and bun work as well. The NFT demo shows a mint as "Mint sent" until its receipt succeeds and never puts a check mark on a mint that reverted, and the token bridge demo reports a reverted mint, approve or send as an error instead of showing the tokens in flight. When the confidential-token demo cannot download its proving circuits, it says which host was blocked and offers "Try again", while a circuit file that fails its integrity check is still refused.
- 742c047: The CLI now checks the Node.js version before it does anything else. Below the supported
  floor (`>=20.11`) it stops with one line that names the version it found and the one it
  needs, instead of failing part-way through with a stack trace; on Node.js 20 or 21 it
  still runs, after one warning that Node.js 20 reached end-of-life in April 2026 and that
  AvaKit is tested on Node.js 22 and 24.

  The published package can no longer carry what tools leave in a template directory: Foundry
  build output (`contracts/out`, `cache`, `broadcast`), `node_modules`, `.next`, `.turbo` and
  `.env` files are now excluded by `files` itself. Until now only a publish from a clean
  checkout was free of them.

- 290b9d2: Freshly scaffolded Fuji apps (`minimal`, `nft-mint`, `token-gated-app`, `erc20-token`, `eerc-token`) can now pay for their first transaction: a new temporary wallet gets test AVAX from AvaKit's shared, rate-limited Fuji faucet, the app says what the faucet is doing and how to carry on when it refuses, and `NEXT_PUBLIC_AVAKIT_FAUCET_URL` points it at your own faucet or switches it off. The local-devnet templates now say plainly that they depend on Avalanche CLI (in maintenance mode, last proven with 1.9.6 in July 2026), the confidential-token template states the EncryptedERC commit it is pinned to, and the faucet links name the Builder Hub faucet and its free sign-in.
- d13b8b8: Scaffolded apps are sturdier: a mainnet scaffold no longer offers the burner wallet or the shared demo Web3Auth key, a deployed contract survives a reload and is dropped after a devnet reset, the token gate shows an unknown balance as "checking" or "failed" instead of "locked", and the ICM demo refuses messages over 256 bytes and reports a message that is not delivered instead of showing it in flight forever. `npm run l1:fuji` now creates and deploys a separate sovereign Proof-of-Authority config instead of the local dev chain, the devnet scripts read the Teleporter address and the public EWOQ dev key from avalanche-cli instead of hardcoding them, and `npm run deploy:eerc` only reuses its cached clone when it is at the pinned commit.

## 0.4.1

### Patch Changes

- c61a23d: Reject unsafe project names (path traversal, absolute paths, separators) before
  scaffolding, and guard against a template writing outside the project directory.

## 0.4.0

### Minor Changes

- 018ebea: Remove the `--wallet` flag, and derive the scaffolded `@avakit/*` version pins per package.

  Every scaffold already ships all three wallets (a zero-setup burner, social login, and Core/MetaMask), so `--wallet` chose nothing — it's gone from the CLI, the wizard, the `scaffoldApp` API, the MCP `scaffold_app` tool, and telemetry. An old `-w <value>` invocation is consumed and ignored so it can't be mistaken for the project name.

  The `@avakit/core` and `@avakit/react` versions stamped into a scaffolded app are now derived per package at build time, instead of a single hand-maintained constant. The two packages version independently, and a single shared number could pin `@avakit/react@^0.3.0` while react was still 0.2.0 — breaking every `pnpm install`. Each app now pins exactly what shipped, even when the versions diverge.

## 0.3.1

### Patch Changes

- fb9f7ca: Fix a Social login button that always threw in `--wallet injected` scaffolds.

  Every template's `providers.tsx` registers the Web3Auth adapter, and its availability check passes against the inlined demo client ID — but `@web3auth/modal` was only installed for `--wallet web3auth`. The button rendered enabled and threw on click. The SDK is now always installed, and `.env.example` is always kept, which also makes the READMEs' `cp .env.example .env.local` step work again.

  Also: `icm-messenger` shipped `nft-mint`'s Cursor rules verbatim, telling agents the project was an NFT dapp and pointing at files it doesn't have. It now has its own. And `token-gated-app`'s `AvaKitNFT.sol` no longer contradicts the bytecode the app actually deploys.

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
