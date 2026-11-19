# @avakit/mcp

## 0.2.1

### Patch Changes

- 8e2ed22: Scaffolded apps now install with npm 10, the npm that ships with Node.js 22. The social login SDK they all include (`@web3auth/modal`) lists vitest among its runtime dependencies, and the peer dependencies that brings in made npm 10 stop with "Cannot read properties of null (reading 'edgesOut')". Every app now has an `.npmrc` with `legacy-peer-deps=true`; it lists every peer it needs as a dependency of its own, so nothing is lost. `@avakit/mcp` is released with it, because the server pins the scaffolder it ships.
- Updated dependencies [8e2ed22]
  - create-avalanche-app@0.4.3

## 0.2.0

### Minor Changes

- d963a43: An agent can now go from a prompt to a minted NFT on Fuji with no key to create: `deploy_contract` and the new `write_contract` sign with a session test wallet that lives only in the server's memory, works on Fuji only and is funded by the AvaKit faucet, contracts are passed by file with `artifactPath` (the paths `scaffold_app` now returns as `artifacts`), and the new `wallet_status` shows which wallet signs and what it holds.
  Mainnet still needs your own `AVAKIT_DEPLOYER_KEY`, `confirm: true` and `AVAKIT_ALLOW_MAINNET=1`, and `AVAKIT_TEST_WALLET=0` turns the session wallet off.
  `deploy_contract` now returns an address only once there is code at it, with its EIP-55 checksum, and every tool is annotated as read-only or not so a client can ask before a write.

### Patch Changes

- 431c3c9: `deploy_contract` now reports a deployment whose transaction reverted as an error
  instead of returning the address of a contract that was never created, and
  `scaffold_app` only creates projects inside the server's working directory (or
  `AVAKIT_MCP_ROOT`) and refuses a chain the template does not support. A server started
  in the filesystem root, as Claude Desktop does on macOS, has no project folder, so
  there `scaffold_app` needs `AVAKIT_MCP_ROOT` to name one. The mainnet gate
  `AVAKIT_ALLOW_MAINNET=1` is now documented in the README and in the tool description,
  and the registry listing no longer advertises minting.
- 34ff1b4: Scaffolded apps start on current dependency versions: every template now pins Next.js 16.4.6, React 19.3.1, viem 2.58.0, Tailwind CSS 4.3.5, lucide-react 1.74.0 and `@web3auth/modal` 11.4.3, all within the major versions they were already on. The packages' own dependencies move to the same versions: `@avakit/core` depends on viem 2.58.0, `@avakit/react` on `@radix-ui/react-dialog` 1.3.1, lucide-react 1.74.0 and tailwind-merge 3.7.0, `@avakit/mcp` and `@avakit/studio` on `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7 and viem 2.58.0, and the scaffolder itself on Ink 7.1.1 and React 19.3.1.
- 2ae6fbb: A file under the 2 MB artifact limit built to make the parser backtrack could keep the server busy for minutes, during which no tool answered; reading an artifact now takes time in proportion to its size. When `scaffold_app` creates a project in a sub-directory (`directory`), its first next step now changes into that path from where the agent stands, instead of into the project's name.
- cdfe3b1: The first `npx -y @avakit/mcp` on a machine is now a small download, so an MCP client no longer times out waiting for the server to connect: the server ships as one file with the MCP SDK, viem, zod and `@avakit/core` bundled into it (their licences are in `dist/THIRD_PARTY_LICENSES.txt`), and installs 48 packages instead of about 150.
  `avakit-mcp --version` prints the version and `avakit-mcp --help` a short usage text; on a slow network, run `npx -y @avakit/mcp --version` once before adding the server to a client.
- 2ee2ec4: `scaffold_app` now gives its next steps with npm (`npm install`, `npm run dev`). They used to say `pnpm install`, which fails on a machine that has only Node.js, and an agent follows those lines literally. `read_chain` takes a contract's ABI the way `write_contract` does: as `artifactPath` (one of the files `scaffold_app` returned) or as `abi`, which can be just the signature of the function. It picks overloads by full signature, refuses a state-changing function with a pointer to `write_contract`, and reports a failed read in one line.
- Updated dependencies [431c3c9]
- Updated dependencies [7eb0ec4]
- Updated dependencies [34ff1b4]
- Updated dependencies [40c8fc5]
- Updated dependencies [f71bacd]
- Updated dependencies [d8cdb7e]
- Updated dependencies [742c047]
- Updated dependencies [290b9d2]
- Updated dependencies [d13b8b8]
  - create-avalanche-app@0.4.2

## 0.1.27

### Patch Changes

- c61a23d: Harden the MCP tools. `scaffold_app` now validates the project name, so a
  prompt-injected agent can't write files outside the target directory.
  `deploy_contract` gates mainnet behind an `AVAKIT_ALLOW_MAINNET` server env
  opt-in (not just the caller-set `confirm`) and checks the deployer balance up
  front. `read_chain` and `deploy_contract` now bound their array/bytecode inputs.
- Updated dependencies [c61a23d]
- Updated dependencies [c61a23d]
  - create-avalanche-app@0.4.1
  - @avakit/core@0.2.1

## 0.1.26

### Patch Changes

- 018ebea: Remove the `--wallet` flag, and derive the scaffolded `@avakit/*` version pins per package.

  Every scaffold already ships all three wallets (a zero-setup burner, social login, and Core/MetaMask), so `--wallet` chose nothing — it's gone from the CLI, the wizard, the `scaffoldApp` API, the MCP `scaffold_app` tool, and telemetry. An old `-w <value>` invocation is consumed and ignored so it can't be mistaken for the project name.

  The `@avakit/core` and `@avakit/react` versions stamped into a scaffolded app are now derived per package at build time, instead of a single hand-maintained constant. The two packages version independently, and a single shared number could pin `@avakit/react@^0.3.0` while react was still 0.2.0 — breaking every `pnpm install`. Each app now pins exactly what shipped, even when the versions diverge.

- Updated dependencies [018ebea]
  - create-avalanche-app@0.4.0

## 0.1.25

### Patch Changes

- ba846e6: Rename the registry listing to `dev.avakit/avalanche`.

  The official MCP Registry's search matches server names, not descriptions — measured: a word that appears only in our description returns zero results. Under the previous name the server was invisible to the one query that matters, `avalanche`, where the only hit is a community docs-only wrapper. No runtime change; the npm package, tools, and config are untouched.

## 0.1.24

### Patch Changes

- 6476590: Claim the server's identity in the MCP Registry.

  Adds `mcpName: dev.avakit/avafox`, which the registry matches against the published package to verify we own it. No runtime change. The listing itself lives in `packages/mcp/server.json`; ownership of the `dev.avakit` namespace is proven by `/.well-known/mcp-registry-auth` on avakit.dev.

- Updated dependencies [fb9f7ca]
  - create-avalanche-app@0.3.1

## 0.1.23

### Patch Changes

- Updated dependencies [5ed124c]
  - create-avalanche-app@0.3.0

## 0.1.22

### Patch Changes

- 6e14b14: Zero-config onboarding: kill the wallet + funding barriers on first run.

  - **@avakit/core:** new `burnerAdapter()` / `clearBurner()` — a zero-config, in-browser temporary wallet (persisted to localStorage) exposed as a standard EIP-1193 provider, so a new user can transact with no extension, dashboard, or client ID. New `@avakit/core/coinbase` subpath with `coinbaseAdapter()` (Coinbase Smart Wallet passkey / ERC-4337, no dashboard). New `requestFaucet()` helper to auto-fund an address from an AvaKit-hosted faucet.
  - **@avakit/react:** `ConnectAvalanche` now leads with a "start instantly" temporary wallet and offers real wallets as the "already have a wallet?" upgrade. New `useFaucet()` hook, an optional `faucetUrl` on `AvaKitProvider` that auto-funds a burner on connect, and an optional `autoConnect="burner"` that connects a temporary wallet when no injected wallet is present.
  - **create-avalanche-app:** every template wires the burner wallet by default. `AVAKIT_DEP_VERSION` now lives in `./api` as a single source of truth shared by the CLI and `@avakit/mcp`, so both scaffolding paths pin the same `@avakit/*` version (fixes MCP-scaffolded apps getting `^0.1.0`).
  - **@avakit/mcp:** inherits the shared dep-version pin via the scaffolder default.

- Updated dependencies [6e14b14]
  - @avakit/core@0.2.0
  - create-avalanche-app@0.2.0

## 0.1.21

### Patch Changes

- 59c28ee: `create-avalanche-app`: the Ink wizard now shows a review/confirm step before
  scaffolding (Enter to accept); the `erc20-token` template waits for the tx receipt
  before re-reading balances (so mint/transfer results show reliably); and scaffolded
  apps now pin `@avakit/*` at `^0.1.6`, so the `web3authAdapter({ chains })` option
  always resolves (older resolutions could fail to typecheck).

  `@avakit/mcp`: new `estimate_gas` tool — estimate the gas a transaction would use,
  plus the current gas price and a rough AVAX cost, over RPC (no key needed).

- Updated dependencies [59c28ee]
  - create-avalanche-app@0.1.21

## 0.1.20

### Patch Changes

- Updated dependencies [bbc240a]
  - create-avalanche-app@0.1.20

## 0.1.19

### Patch Changes

- Updated dependencies [e2d9841]
  - create-avalanche-app@0.1.19

## 0.1.18

### Patch Changes

- Updated dependencies [747ece8]
  - create-avalanche-app@0.1.18

## 0.1.17

### Patch Changes

- 7d493d9: Add an AvaKit brand banner to every terminal session — an ASCII mountain (snow
  cap) above a block-letter AVAKIT wordmark in an Ember Crimson gradient. Printed on
  startup by `create-avalanche-app`, `@avakit/mcp`, and `@avakit/studio`. It's raw
  ANSI with no dependencies; color auto-disables on a non-TTY / when `NO_COLOR` is
  set, and the MCP servers write it to stderr so the JSON-RPC channel stays clean.
  `@avakit/studio`'s dashboard also gains a one-time terminal-style boot splash.
- Updated dependencies [7d493d9]
  - create-avalanche-app@0.1.17

## 0.1.16

### Patch Changes

- Updated dependencies [a9a6bef]
  - @avakit/core@0.1.6
  - create-avalanche-app@0.1.16

## 0.1.15

### Patch Changes

- Updated dependencies [bf9f5ce]
  - create-avalanche-app@0.1.15

## 0.1.14

### Patch Changes

- be5129e: Fix the mint flow in the nft-mint and token-gated-app templates so a successful
  mint reliably reflects in the UI. Previously `contract.write("mint", [])`
  returned the tx hash as soon as it was broadcast, and the app re-read
  `totalSupply`/`balanceOf` before the tx was mined — so the counts stayed at their
  old values and the mint looked like it did nothing. The templates now wait for
  the transaction receipt (and surface an on-chain revert) before refreshing state.
  Shipped through both the CLI (`create-avalanche-app`) and the MCP scaffold path
  (`@avakit/mcp`).
- Updated dependencies [c2b044b]
- Updated dependencies [be5129e]
  - @avakit/core@0.1.5
  - create-avalanche-app@0.1.14

## 0.1.9

### Patch Changes

- Updated dependencies
  - create-avalanche-app@0.1.9

## 0.1.8

### Patch Changes

- b78857d: Security & repo-hygiene pass:

  - create-avalanche-app: stop shipping stray Foundry build artifacts (contracts/out, cache, build-info) that had leaked into the icm-messenger template tarball; add an `.npmignore` guard so they can never ship again.
  - @avakit/studio: validate the L1 name before it reaches the Fuji key-balance filesystem path (defence-in-depth); rename the `DataView` UI component so it no longer shadows the JS global.
  - All packages: derive the reported version from package.json (single source of truth) instead of a hardcoded constant. Fixes the MCP handshake reporting a stale `0.1.0` for both `@avakit/mcp` and `@avakit/studio`.

- Updated dependencies [b78857d]
  - create-avalanche-app@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies
  - create-avalanche-app@0.1.7

## 0.1.6

### Patch Changes

- Add the `token-bridge` template — bridge an ERC-20 between two Avalanche L1s with Interchain Token Transfer (ICTT), over a one-command local devnet (`pnpm bridge` spins up two L1s + a relayer and deploys a demo token + ERC20TokenHome + ERC20TokenRemote, registered over ICM). The bridge UI locks tokens on the home chain and mints the bridged token on the remote chain (and back). Contracts are compiled from `ava-labs/icm-contracts` with the optimizer and bundled as bytecode, so the bridge deploys with no Solidity toolchain on the user's machine. The MCP `scaffold_app` tool lists `token-bridge`.
- Updated dependencies
  - create-avalanche-app@0.1.6

## 0.1.5

### Patch Changes

- Add the `l1-launch` template — launch your own Avalanche L1 with one command (`pnpm l1`), then explore it in a built-in dashboard: live blocks and transactions, your balance, and a browser contract deploy, all read straight from the chain's RPC with viem (no Docker, no third-party indexer). Ships a config-decision explainer (VM, consensus/sovereignty, chain ID, token, EWOQ warning) and an advanced `pnpm l1:fuji` path to graduate the chain to the Fuji testnet. AvaKit Studio gains a matching "Launch your own L1" panel (create + deploy a single custom Subnet-EVM chain, with strict input validation) and a `devnet_launch_l1` MCP tool. The MCP `scaffold_app` tool lists `l1-launch`.
- Updated dependencies
  - create-avalanche-app@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies
  - create-avalanche-app@0.1.4

## 0.1.3

### Patch Changes

- Add the `eerc-token` template — a confidential-token dapp built on Avalanche's Encrypted ERC (eERC) standard (register, private mint, confidential transfer, private burn with hidden balances), proven live on Fuji. Also fix `pnpm dev` on freshly scaffolded apps under pnpm by shipping a `pnpm-workspace.yaml` that pre-approves native build scripts (`sharp`), so the dev server starts without an `ERR_PNPM_IGNORED_BUILDS` failure. The MCP `scaffold_app` tool now lists `eerc-token` (and backfills `icm-messenger`).
- Updated dependencies
  - create-avalanche-app@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies
- Updated dependencies
  - create-avalanche-app@0.1.2
  - @avakit/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [4f80b58]
- Updated dependencies [f9c9040]
  - @avakit/core@0.1.1
  - create-avalanche-app@0.1.1
