---
"create-avalanche-app": patch
"@avakit/mcp": patch
---

Fix the mint flow in the nft-mint and token-gated-app templates so a successful
mint reliably reflects in the UI. Previously `contract.write("mint", [])`
returned the tx hash as soon as it was broadcast, and the app re-read
`totalSupply`/`balanceOf` before the tx was mined — so the counts stayed at their
old values and the mint looked like it did nothing. The templates now wait for
the transaction receipt (and surface an on-chain revert) before refreshing state.
Shipped through both the CLI (`create-avalanche-app`) and the MCP scaffold path
(`@avakit/mcp`).
