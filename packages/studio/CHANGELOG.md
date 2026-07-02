# @avakit/studio

## 0.1.5

### Patch Changes

- b78857d: Security & repo-hygiene pass:

  - create-avalanche-app: stop shipping stray Foundry build artifacts (contracts/out, cache, build-info) that had leaked into the icm-messenger template tarball; add an `.npmignore` guard so they can never ship again.
  - @avakit/studio: validate the L1 name before it reaches the Fuji key-balance filesystem path (defence-in-depth); rename the `DataView` UI component so it no longer shadows the JS global.
  - All packages: derive the reported version from package.json (single source of truth) instead of a hardcoded constant. Fixes the MCP handshake reporting a stale `0.1.0` for both `@avakit/mcp` and `@avakit/studio`.

## 0.1.4

### Patch Changes

- Add a guided "Launch on Fuji" wizard to AvaKit Studio: a 4-step flow (create + fund a key with a live C-Chain balance poller → C→P transfer → deploy a sovereign L1 to the Fuji testnet with a live progress log → live RPC + one-click add-to-wallet) that drives avalanche-cli server-side and hides its interactive prompts. Also improve the `l1-launch` template: a post-setup "next steps" card in the dashboard (add-to-wallet, faucet link, deploy-first-contract, and a keep-the-node-running + cost warning on Fuji), and a state-aware AI guide in `CLAUDE.md` so Claude Code / Cursor can walk a user through the Fuji flow step by step.

## 0.1.3

### Patch Changes

- Add the `l1-launch` template — launch your own Avalanche L1 with one command (`pnpm l1`), then explore it in a built-in dashboard: live blocks and transactions, your balance, and a browser contract deploy, all read straight from the chain's RPC with viem (no Docker, no third-party indexer). Ships a config-decision explainer (VM, consensus/sovereignty, chain ID, token, EWOQ warning) and an advanced `pnpm l1:fuji` path to graduate the chain to the Fuji testnet. AvaKit Studio gains a matching "Launch your own L1" panel (create + deploy a single custom Subnet-EVM chain, with strict input validation) and a `devnet_launch_l1` MCP tool. The MCP `scaffold_app` tool lists `l1-launch`.

## 0.1.2

### Patch Changes

- Updated dependencies
  - @avakit/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [4f80b58]
  - @avakit/core@0.1.1
