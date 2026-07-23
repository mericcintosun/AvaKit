---
"@avakit/react": patch
---

`AvaKitProvider` only auto-connects the burner wallet on a testnet, and never
auto-funds it on mainnet — matching the burner's testnet-only guarantee.
