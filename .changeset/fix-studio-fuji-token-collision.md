---
"@avakit/studio": patch
---

Fix the "Launch on Fuji" wizard (and the devnet "Launch your own L1" card) failing from
the UI: the EventSource URL used the `token` query param for BOTH the session auth token
and the L1's native-token symbol, so the symbol clobbered the auth token and every
transfer/deploy stream returned 401. The L1 token symbol now travels as `symbol`, leaving
`token` for auth. Verified end-to-end: a real sovereign L1 (chainId 99001) launched on
Fuji entirely through the Studio wizard endpoints — C→P transfer, ConvertSubnetToL1Tx,
PoA validator manager, live RPC, listed on the Fuji P-Chain, and advancing blocks.
