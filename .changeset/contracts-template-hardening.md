---
"create-avalanche-app": patch
---

Harden the contracts the templates ship: the NFT keeps its on-chain art when it
is transferred, names the network it is actually deployed on and reverts
`balanceOf` for the zero address and `getApproved` for a missing token as
ERC-721 requires, while the ICM messenger rejects a zero origin sender from an
unregistered chain and caps messages at 256 bytes so a delivery always fits its
gas budget. Each template's `foundry.toml` now pins the EVM version (`cancun`)
beside solc, so `forge build` reproduces the bundled bytecode byte for byte.
