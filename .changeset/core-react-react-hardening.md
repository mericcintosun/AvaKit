---
"@avakit/react": patch
---

The published bundle keeps its `"use client"` directive, so the package can be imported from Next.js Server Components, and the pure helpers are also available from the new server-safe `@avakit/react/utils` entry. `AvaKitProvider` now follows account, network and disconnect events from the wallet and never keeps a burner wallet connected on a mainnet; the data hooks gain `pageSize`, `hasMore` and `fetchMore` and no longer show a previous account's items, `useContract` returns a stable object, `useBalance` reports an `error`, `<ConnectAvalanche />` closes its dialog on disconnect, and `humanizeError` recognises viem's insufficient-funds and rejection errors.
