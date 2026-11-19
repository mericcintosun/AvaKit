# @avakit/studio

## 0.1.14

### Patch Changes

- 7eb0ec4: Studio now deploys the hardened ICM messenger: it rejects a zero origin sender
  from an unregistered chain, and refuses a message longer than 256 bytes when it
  is sent instead of letting it run out of gas on delivery and never arrive.
- 34ff1b4: Scaffolded apps start on current dependency versions: every template now pins Next.js 16.4.6, React 19.3.1, viem 2.58.0, Tailwind CSS 4.3.5, lucide-react 1.74.0 and `@web3auth/modal` 11.4.3, all within the major versions they were already on. The packages' own dependencies move to the same versions: `@avakit/core` depends on viem 2.58.0, `@avakit/react` on `@radix-ui/react-dialog` 1.3.1, lucide-react 1.74.0 and tailwind-merge 3.7.0, `@avakit/mcp` and `@avakit/studio` on `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7 and viem 2.58.0, and the scaffolder itself on Ink 7.1.1 and React 19.3.1.
- 8575b2e: Stopping Studio (Ctrl+C, or an agent's client ending `avakit-studio mcp`) while an avalanche-cli command it started is still running no longer frees the action lock: the command keeps running, as before, and every other Studio refuses new actions until it has finished, saying which command is still running. Deploying the Interchain messengers and sending a message now take the same lock, so they can no longer overlap with each other, across the dashboard and the MCP server, or with a devnet start or stop. A lock left by a crashed Studio whose pid now belongs to another process no longer blocks anything, and every refusal from another Studio names the lock file and says when it is safe to delete it.
- 0caa99e: Studio's one-action-at-a-time rule now holds across every Studio process: the dashboard and `avakit-studio mcp` share a lock file (`~/.avakit-studio/action.lock`), so an agent and a click in the dashboard can no longer run avalanche-cli at the same time, and both refuse with the same "Another action (…) is still running" message. Launching a local L1 or deploying to Fuji under a name whose existing config has another chain ID or token is refused with the existing values named, instead of deploying the old chain and reporting the new values as done; a matching config is reused and the log says so. The Fuji wizard only moves on (and only transfers testnet AVAX) once the name, chain ID, token and amount pass the server's own rules, and the chain ID and token stay editable until the deploy has run. Interchain's `ready` (dashboard, `/api/icm/state` and the `icm_state` tool) is now true only when two messengers are deployed and linked — the new `hasPeers` says that two L1s are running — and the Overview card and Devnet banner say "deploy the messengers to send a message" until then. An open tab shows a stopped or restarted Studio as disconnected within one status poll.
- 21f77a2: Studio's Interchain view now works with any number of local L1s: it lists only the running, ICM-ready ones, lets you pick source and destination, links messengers that share an address, replaces a messenger that went with a devnet reset or predates the 256-byte message limit, and delivers a message exactly as typed (checked against that limit before it is sent). avalanche-cli actions now belong to the Studio server (one at a time, with a Cancel button), so a run and its log survive switching views, reloading or closing the tab; a malformed request can no longer crash Studio, a failed step is no longer reported as success, and a Data lookup shows an API failure as a failure instead of an empty wallet.
- Updated dependencies [54b59ec]
- Updated dependencies [34ff1b4]
- Updated dependencies [1ea2122]
- Updated dependencies [2ce3645]
  - @avakit/core@0.2.2

## 0.1.13

### Patch Changes

- c61a23d: Compare the Studio session token in constant time, closing a timing
  side-channel that could reveal it byte by byte.
- Updated dependencies [c61a23d]
  - @avakit/core@0.2.1

## 0.1.12

### Patch Changes

- Updated dependencies [6e14b14]
  - @avakit/core@0.2.0

## 0.1.11

### Patch Changes

- bbc240a: `create-avalanche-app`: after scaffolding, the wizard offers to start the dev
  server for you (`Start the dev server now?`), so you don't have to `cd` + run it
  by hand. Only shown for dev-able templates once dependencies are installed;
  declining just prints the next steps as before.

  `@avakit/studio`: the startup output is now a crimson-bordered panel showing the
  dashboard URL, matching the CLI banner's look.

## 0.1.10

### Patch Changes

- 7d493d9: Add an AvaKit brand banner to every terminal session — an ASCII mountain (snow
  cap) above a block-letter AVAKIT wordmark in an Ember Crimson gradient. Printed on
  startup by `create-avalanche-app`, `@avakit/mcp`, and `@avakit/studio`. It's raw
  ANSI with no dependencies; color auto-disables on a non-TTY / when `NO_COLOR` is
  set, and the MCP servers write it to stderr so the JSON-RPC channel stays clean.
  `@avakit/studio`'s dashboard also gains a one-time terminal-style boot splash.

## 0.1.9

### Patch Changes

- Updated dependencies [a9a6bef]
  - @avakit/core@0.1.6

## 0.1.8

### Patch Changes

- Updated dependencies [c2b044b]
  - @avakit/core@0.1.5

## 0.1.6

### Patch Changes

- a4971e3: Fix the "Launch on Fuji" wizard (and the devnet "Launch your own L1" card) failing from
  the UI: the EventSource URL used the `token` query param for BOTH the session auth token
  and the L1's native-token symbol, so the symbol clobbered the auth token and every
  transfer/deploy stream returned 401. The L1 token symbol now travels as `symbol`, leaving
  `token` for auth. Verified end-to-end: a real sovereign L1 (chainId 99001) launched on
  Fuji entirely through the Studio wizard endpoints — C→P transfer, ConvertSubnetToL1Tx,
  PoA validator manager, live RPC, listed on the Fuji P-Chain, and advancing blocks.

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
