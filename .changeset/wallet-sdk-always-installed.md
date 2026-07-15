---
"create-avalanche-app": patch
---

Fix a Social login button that always threw in `--wallet injected` scaffolds.

Every template's `providers.tsx` registers the Web3Auth adapter, and its availability check passes against the inlined demo client ID — but `@web3auth/modal` was only installed for `--wallet web3auth`. The button rendered enabled and threw on click. The SDK is now always installed, and `.env.example` is always kept, which also makes the READMEs' `cp .env.example .env.local` step work again.

Also: `icm-messenger` shipped `nft-mint`'s Cursor rules verbatim, telling agents the project was an NFT dapp and pointing at files it doesn't have. It now has its own. And `token-gated-app`'s `AvaKitNFT.sol` no longer contradicts the bytecode the app actually deploys.
