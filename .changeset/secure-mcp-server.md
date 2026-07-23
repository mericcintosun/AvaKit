---
"@avakit/mcp": patch
---

Harden the MCP tools. `scaffold_app` now validates the project name, so a
prompt-injected agent can't write files outside the target directory.
`deploy_contract` gates mainnet behind an `AVAKIT_ALLOW_MAINNET` server env
opt-in (not just the caller-set `confirm`) and checks the deployer balance up
front. `read_chain` and `deploy_contract` now bound their array/bytecode inputs.
