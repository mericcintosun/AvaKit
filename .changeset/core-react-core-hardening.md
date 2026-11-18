---
"@avakit/core": patch
---

Hardens wallets and deploys: `ensureChain` no longer sends an empty block explorer URL (which wallets reject for a fresh L1) and now really switches the burner wallet, `deployContract` rejects a reverted deployment and checks the balance before a confirmed mainnet deploy, and a chain that does not say `testnet: true` is treated as a mainnet. `coinbaseAdapter` loads `@coinbase/wallet-sdk` through an import that bundlers can follow and reports failures by their real cause, and `web3authAdapter` retries a failed initialisation instead of staying broken until the page is reloaded.
