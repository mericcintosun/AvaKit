---
"@avakit/core": patch
"@avakit/mcp": patch
---

When a chain's RPC endpoint stops answering, `getPublicClient`, the new `getRpcTransport(chain)` and the temporary (burner) wallet now move on to the chain's next one (Fuji and C-Chain try Allnodes' PublicNode after Ava Labs' public API, and a custom chain can list its own in the new optional `rpcUrls`, read through `rpcEndpoints(chain)`), and `@avakit/mcp` is released with it because it bundles `@avakit/core`.
