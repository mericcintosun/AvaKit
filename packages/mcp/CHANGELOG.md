# @avakit/mcp

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
