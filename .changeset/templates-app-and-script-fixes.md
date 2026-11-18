---
"create-avalanche-app": patch
---

Scaffolded apps are sturdier: a mainnet scaffold no longer offers the burner wallet or the shared demo Web3Auth key, a deployed contract survives a reload and is dropped after a devnet reset, the token gate shows an unknown balance as "checking" or "failed" instead of "locked", and the ICM demo refuses messages over 256 bytes and reports a message that is not delivered instead of showing it in flight forever. `npm run l1:fuji` now creates and deploys a separate sovereign Proof-of-Authority config instead of the local dev chain, the devnet scripts read the Teleporter address and the public EWOQ dev key from avalanche-cli instead of hardcoding them, and `npm run deploy:eerc` only reuses its cached clone when it is at the pinned commit.
