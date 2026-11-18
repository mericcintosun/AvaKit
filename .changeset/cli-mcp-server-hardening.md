---
"@avakit/mcp": patch
---

`deploy_contract` now reports a deployment whose transaction reverted as an error
instead of returning the address of a contract that was never created, and
`scaffold_app` only creates projects inside the server's working directory (or
`AVAKIT_MCP_ROOT`) and refuses a chain the template does not support. A server started
in the filesystem root, as Claude Desktop does on macOS, has no project folder, so
there `scaffold_app` needs `AVAKIT_MCP_ROOT` to name one. The mainnet gate
`AVAKIT_ALLOW_MAINNET=1` is now documented in the README and in the tool description,
and the registry listing no longer advertises minting.
