---
"@avakit/core": patch
---

Harden chain and wallet safety. `defineChain` rejects non-http(s) URLs when
present and refuses to label a known mainnet id as a testnet; deploy guards key
off a new `isMainnet()` so a mislabelled chain can't dodge the mainnet
confirmation. The burner wallet is now testnet-only — it refuses to connect on,
or switch to, a mainnet chain.
