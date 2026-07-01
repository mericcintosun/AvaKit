# @avakit/core

## 0.1.2

### Patch Changes

- Fix the Web3Auth adapter for `@web3auth/modal` v11: `connect()` resolves to a Connection, so the EIP-1193 provider is read from `ethereumProvider` (the old code used the Connection object as the provider). Chain switching now falls back to generic EIP-1193 add/switch when the SDK's `switchChain` isn't available. Still pending a live browser sign-in for full validation.

## 0.1.1

### Patch Changes

- 4f80b58: Add AvaCloud/Glacier Data API helpers and React hooks for indexed chain data — no indexer required. `@avakit/core` gains `getNativeBalance`, `listErc20Balances`, `listNfts`, and `listTransactions` (keyless by default, optional API key). `@avakit/react` gains `useTokenBalances`, `useNfts`, and `useTxHistory`, plus a `dataApiKey` prop on `<AvaKitProvider>`.
