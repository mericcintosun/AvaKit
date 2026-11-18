---
"@avakit/react": patch
---

The published bundle keeps its `"use client"` directive, so the package can be imported from Next.js Server Components, and the pure helpers are also available from the new server-safe `@avakit/react/utils` entry. `AvaKitProvider` now follows account, network and disconnect events from the wallet and never keeps a burner wallet connected on a mainnet; the data hooks gain `pageSize`, `hasMore` and `fetchMore`, `useContract` returns a stable object, `useBalance` reports an `error`, and `humanizeError` recognises viem's insufficient-funds and rejection errors.
