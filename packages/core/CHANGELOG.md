# @avakit/core

## 0.2.3

### Patch Changes

- b6294bc: A faucet its operator has paused (the AvaKit faucet's `503 faucet_paused`) now makes `requestFaucet` reject with the new `FaucetError` code `"paused"`, no longer with `"empty"`, which is what a 503 reads as by its status alone; it is not retried, and the message is still the faucet's own. The faucet's other new refusal, a spent daily limit (`429 daily_limited`), is now read as `"rate_limited"` by its code, as it already was by its status, with a `retryAfterMs` that counts down to 00:00 UTC.
- 763ddf0: `@avakit/core` now declares Node.js 22 or newer in `engines.node`, the oldest release line AvaKit is tested on; Node.js 20 reached end of life in April 2026, and the social login SDK it works with (`@web3auth/modal`) already requires Node.js 22.
- d2df8f4: When a chain's RPC endpoint fails a request (it cannot be reached, gives no answer within 10 seconds, answers with an HTTP error, or answers that it is busy, behind, over a limit or without the method), `getPublicClient`, the new `getRpcTransport(chain)` and the temporary (burner) wallet move on to the chain's next endpoint: Fuji and C-Chain try Allnodes' PublicNode after Ava Labs' public API, and a custom chain can list its own in the new optional `rpcUrls`, read through `rpcEndpoints(chain)`. A node's answer about the request itself, such as a revert, "nonce too low" or "insufficient funds", is returned as that node gave it and never sent on to another endpoint, and a call that fails at every endpoint rejects with the new `RpcEndpointsError`, which names each endpoint by its origin (never a password or API key from the URL), says how each failed and keeps viem's error for the last one as its `cause`. `toViemChain(chain).rpcUrls.default.http` and the `wallet_addEthereumChain` request that `ensureChain` makes now list every endpoint, primary first; the burner sends each transaction through one endpoint whose node has confirmed the chain, and the reads it forwards now have the same 10-second limit and keep the node's JSON-RPC error code and data, so a revert no longer reaches the app as "An unknown RPC error occurred.". A call that gets no answer at any endpoint can now take up to four attempts × the number of endpoints × 10 seconds (80 seconds on Fuji and C-Chain, against 40 before), and `@avakit/mcp` is released with this change because it bundles `@avakit/core`.

## 0.2.2

### Patch Changes

- 54b59ec: Hardens wallets and deploys: `ensureChain` no longer sends an empty block explorer URL (which wallets reject for a fresh L1) and now really switches the burner wallet, `deployContract` rejects a reverted deployment and checks the balance before a confirmed mainnet deploy, and a chain that does not say `testnet: true` is treated as a mainnet. `coinbaseAdapter` loads `@coinbase/wallet-sdk` through an import that bundlers can follow and reports failures by their real cause, `web3authAdapter` retries a failed initialisation instead of staying broken until the page is reloaded, and a burner wallet created with `persist: false` keeps its address across reconnects.
- 34ff1b4: Scaffolded apps start on current dependency versions: every template now pins Next.js 16.4.6, React 19.3.1, viem 2.58.0, Tailwind CSS 4.3.5, lucide-react 1.74.0 and `@web3auth/modal` 11.4.3, all within the major versions they were already on. The packages' own dependencies move to the same versions: `@avakit/core` depends on viem 2.58.0, `@avakit/react` on `@radix-ui/react-dialog` 1.3.1, lucide-react 1.74.0 and tailwind-merge 3.7.0, `@avakit/mcp` and `@avakit/studio` on `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7 and viem 2.58.0, and the scaffolder itself on Ink 7.1.1 and React 19.3.1.
- 1ea2122: The temporary (burner) wallet now asks the chain's RPC which chain it serves before its first transaction on that chain, and signs a transaction only for the chain id its definition names: a chain defined as a testnet whose `rpcUrl` points at a mainnet (or any other chain) is refused with an error that starts "Nothing was signed or sent:", and `humanizeError` shows that message instead of viem's "An unknown RPC error occurred.". In `@avakit/react`, a `fund()` that joins a faucet request already in flight (for example after `reset()`) now reports "funding" and the outcome through `useFaucet()` instead of leaving it at "idle", and calling `fetchMore()` twice from the same render no longer fetches and appends the same page twice.
- 2ce3645: Faucet requests now fail with a typed `FaucetError` (`code`, `retryable`, `retryAfterMs`), retry a temporary failure a bounded number of times and give up on a faucet that hangs, and `useFaucet()` shows the automatic burner drip as well as a manual `fund()` while leaving a wallet that already holds funds alone. `deployContract` resolves only once the contract's code is on chain (the same check is available as `waitForDeployment`), the built-in explorer and faucet links point straight at Builder Hub instead of redirecting there, and the hosted faucet endpoint is exported as `AVAKIT_FAUCET_URL`.

## 0.2.1

### Patch Changes

- c61a23d: Harden chain and wallet safety. `defineChain` rejects non-http(s) URLs when
  present and refuses to label a known mainnet id as a testnet; deploy guards key
  off a new `isMainnet()` so a mislabelled chain can't dodge the mainnet
  confirmation. The burner wallet is now testnet-only — it refuses to connect on,
  or switch to, a mainnet chain.

## 0.2.0

### Minor Changes

- 6e14b14: Zero-config onboarding: kill the wallet + funding barriers on first run.

  - **@avakit/core:** new `burnerAdapter()` / `clearBurner()` — a zero-config, in-browser temporary wallet (persisted to localStorage) exposed as a standard EIP-1193 provider, so a new user can transact with no extension, dashboard, or client ID. New `@avakit/core/coinbase` subpath with `coinbaseAdapter()` (Coinbase Smart Wallet passkey / ERC-4337, no dashboard). New `requestFaucet()` helper to auto-fund an address from an AvaKit-hosted faucet.
  - **@avakit/react:** `ConnectAvalanche` now leads with a "start instantly" temporary wallet and offers real wallets as the "already have a wallet?" upgrade. New `useFaucet()` hook, an optional `faucetUrl` on `AvaKitProvider` that auto-funds a burner on connect, and an optional `autoConnect="burner"` that connects a temporary wallet when no injected wallet is present.
  - **create-avalanche-app:** every template wires the burner wallet by default. `AVAKIT_DEP_VERSION` now lives in `./api` as a single source of truth shared by the CLI and `@avakit/mcp`, so both scaffolding paths pin the same `@avakit/*` version (fixes MCP-scaffolded apps getting `^0.1.0`).
  - **@avakit/mcp:** inherits the shared dep-version pin via the scaffolder default.

## 0.1.6

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

## 0.1.2

### Patch Changes

- Fix the Web3Auth adapter for `@web3auth/modal` v11: `connect()` resolves to a Connection, so the EIP-1193 provider is read from `ethereumProvider` (the old code used the Connection object as the provider). Chain switching now falls back to generic EIP-1193 add/switch when the SDK's `switchChain` isn't available. Still pending a live browser sign-in for full validation.

## 0.1.1

### Patch Changes

- 4f80b58: Add AvaCloud/Glacier Data API helpers and React hooks for indexed chain data — no indexer required. `@avakit/core` gains `getNativeBalance`, `listErc20Balances`, `listNfts`, and `listTransactions` (keyless by default, optional API key). `@avakit/react` gains `useTokenBalances`, `useNfts`, and `useTxHistory`, plus a `dataApiKey` prop on `<AvaKitProvider>`.
