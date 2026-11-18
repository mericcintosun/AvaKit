---
"create-avalanche-app": patch
---

Freshly scaffolded Fuji apps (`minimal`, `nft-mint`, `token-gated-app`, `erc20-token`, `eerc-token`) can now pay for their first transaction: a new temporary wallet gets test AVAX from AvaKit's shared, rate-limited Fuji faucet, the app says what the faucet is doing and how to carry on when it refuses, and `NEXT_PUBLIC_AVAKIT_FAUCET_URL` points it at your own faucet or switches it off. The local-devnet templates now say plainly that they depend on Avalanche CLI (in maintenance mode, last proven with 1.9.6 in July 2026), the confidential-token template states the EncryptedERC commit it is pinned to, and the faucet links name the Builder Hub faucet and its free sign-in.
