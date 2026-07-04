# @avakit/react

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
