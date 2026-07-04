---
"create-avalanche-app": patch
"@avakit/mcp": patch
---

`create-avalanche-app`: the Ink wizard now shows a review/confirm step before
scaffolding (Enter to accept); the `erc20-token` template waits for the tx receipt
before re-reading balances (so mint/transfer results show reliably); and scaffolded
apps now pin `@avakit/*` at `^0.1.6`, so the `web3authAdapter({ chains })` option
always resolves (older resolutions could fail to typecheck).

`@avakit/mcp`: new `estimate_gas` tool — estimate the gas a transaction would use,
plus the current gas price and a rough AVAX cost, over RPC (no key needed).
