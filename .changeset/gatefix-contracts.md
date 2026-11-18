---
"create-avalanche-app": patch
---

Tokens minted from the `nft-mint` and `token-gated-app` templates no longer
claim to have been minted at avakit.dev/new with no install and no gas: the
on-chain description now reads "Generated on-chain by the AvaKitNFT contract.
The art is derived from the token and never changes.", which holds wherever
the contract is deployed. The demo token the `token-bridge` template deploys is
rebuilt from the `erc20-token` contract with the pinned compiler settings (its
behaviour is unchanged; only the metadata hash at the end of the bytecode
differs).
