# @avakit/react

## 0.2.2

### Patch Changes

- 54b59ec: The published bundle keeps its `"use client"` directive, so the package can be imported from Next.js Server Components, and the pure helpers are also available from the new server-safe `@avakit/react/utils` entry. `AvaKitProvider` now follows account, network and disconnect events from the wallet and never keeps a burner wallet connected on a mainnet; the data hooks gain `pageSize`, `hasMore` and `fetchMore` and no longer show a previous account's items, `useContract` returns a stable object, `useBalance` reports an `error`, `<ConnectAvalanche />` closes its dialog on disconnect, and `humanizeError` recognises viem's insufficient-funds and rejection errors.
- 34ff1b4: Scaffolded apps start on current dependency versions: every template now pins Next.js 16.4.6, React 19.3.1, viem 2.58.0, Tailwind CSS 4.3.5, lucide-react 1.74.0 and `@web3auth/modal` 11.4.3, all within the major versions they were already on. The packages' own dependencies move to the same versions: `@avakit/core` depends on viem 2.58.0, `@avakit/react` on `@radix-ui/react-dialog` 1.3.1, lucide-react 1.74.0 and tailwind-merge 3.7.0, `@avakit/mcp` and `@avakit/studio` on `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7 and viem 2.58.0, and the scaffolder itself on Ink 7.1.1 and React 19.3.1.
- 1ea2122: The temporary (burner) wallet now asks the chain's RPC which chain it serves before its first transaction on that chain, and signs a transaction only for the chain id its definition names: a chain defined as a testnet whose `rpcUrl` points at a mainnet (or any other chain) is refused with an error that starts "Nothing was signed or sent:", and `humanizeError` shows that message instead of viem's "An unknown RPC error occurred.". In `@avakit/react`, a `fund()` that joins a faucet request already in flight (for example after `reset()`) now reports "funding" and the outcome through `useFaucet()` instead of leaving it at "idle", and calling `fetchMore()` twice from the same render no longer fetches and appends the same page twice.
- 2ce3645: Faucet requests now fail with a typed `FaucetError` (`code`, `retryable`, `retryAfterMs`), retry a temporary failure a bounded number of times and give up on a faucet that hangs, and `useFaucet()` shows the automatic burner drip as well as a manual `fund()` while leaving a wallet that already holds funds alone. `deployContract` resolves only once the contract's code is on chain (the same check is available as `waitForDeployment`), the built-in explorer and faucet links point straight at Builder Hub instead of redirecting there, and the hosted faucet endpoint is exported as `AVAKIT_FAUCET_URL`.
- Updated dependencies [54b59ec]
- Updated dependencies [34ff1b4]
- Updated dependencies [1ea2122]
- Updated dependencies [2ce3645]
  - @avakit/core@0.2.2

## 0.2.1

### Patch Changes

- c61a23d: `AvaKitProvider` only auto-connects the burner wallet on a testnet, and never
  auto-funds it on mainnet — matching the burner's testnet-only guarantee.
- Updated dependencies [c61a23d]
  - @avakit/core@0.2.1

## 0.2.0

### Minor Changes

- 6e14b14: Zero-config onboarding: kill the wallet + funding barriers on first run.

  - **@avakit/core:** new `burnerAdapter()` / `clearBurner()` — a zero-config, in-browser temporary wallet (persisted to localStorage) exposed as a standard EIP-1193 provider, so a new user can transact with no extension, dashboard, or client ID. New `@avakit/core/coinbase` subpath with `coinbaseAdapter()` (Coinbase Smart Wallet passkey / ERC-4337, no dashboard). New `requestFaucet()` helper to auto-fund an address from an AvaKit-hosted faucet.
  - **@avakit/react:** `ConnectAvalanche` now leads with a "start instantly" temporary wallet and offers real wallets as the "already have a wallet?" upgrade. New `useFaucet()` hook, an optional `faucetUrl` on `AvaKitProvider` that auto-funds a burner on connect, and an optional `autoConnect="burner"` that connects a temporary wallet when no injected wallet is present.
  - **create-avalanche-app:** every template wires the burner wallet by default. `AVAKIT_DEP_VERSION` now lives in `./api` as a single source of truth shared by the CLI and `@avakit/mcp`, so both scaffolding paths pin the same `@avakit/*` version (fixes MCP-scaffolded apps getting `^0.1.0`).
  - **@avakit/mcp:** inherits the shared dep-version pin via the scaffolder default.

### Patch Changes

- Updated dependencies [6e14b14]
  - @avakit/core@0.2.0

## 0.1.6

### Patch Changes

- Updated dependencies [a9a6bef]
  - @avakit/core@0.1.6

## 0.1.5

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

- Updated dependencies [c2b044b]
  - @avakit/core@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies
  - @avakit/core@0.1.2

## 0.1.2

### Patch Changes

- 4f80b58: Add AvaCloud/Glacier Data API helpers and React hooks for indexed chain data — no indexer required. `@avakit/core` gains `getNativeBalance`, `listErc20Balances`, `listNfts`, and `listTransactions` (keyless by default, optional API key). `@avakit/react` gains `useTokenBalances`, `useNfts`, and `useTxHistory`, plus a `dataApiKey` prop on `<AvaKitProvider>`.
- Updated dependencies [4f80b58]
  - @avakit/core@0.1.1
