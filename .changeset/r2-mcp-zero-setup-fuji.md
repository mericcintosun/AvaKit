---
"@avakit/mcp": minor
---

An agent can now go from a prompt to a minted NFT on Fuji with no key to create: `deploy_contract` and the new `write_contract` sign with a session test wallet that lives only in the server's memory, works on Fuji only and is funded by the AvaKit faucet, contracts are passed by file with `artifactPath` (the paths `scaffold_app` now returns as `artifacts`), and the new `wallet_status` shows which wallet signs and what it holds.
Mainnet still needs your own `AVAKIT_DEPLOYER_KEY`, `confirm: true` and `AVAKIT_ALLOW_MAINNET=1`, and `AVAKIT_TEST_WALLET=0` turns the session wallet off.
