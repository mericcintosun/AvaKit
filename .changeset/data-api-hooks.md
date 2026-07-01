---
"@avakit/core": patch
"@avakit/react": patch
---

Add AvaCloud/Glacier Data API helpers and React hooks for indexed chain data — no indexer required. `@avakit/core` gains `getNativeBalance`, `listErc20Balances`, `listNfts`, and `listTransactions` (keyless by default, optional API key). `@avakit/react` gains `useTokenBalances`, `useNfts`, and `useTxHistory`, plus a `dataApiKey` prop on `<AvaKitProvider>`.
