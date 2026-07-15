---
"@avakit/mcp": patch
---

Claim the server's identity in the MCP Registry.

Adds `mcpName: dev.avakit/avafox`, which the registry matches against the published package to verify we own it. No runtime change. The listing itself lives in `packages/mcp/server.json`; ownership of the `dev.avakit` namespace is proven by `/.well-known/mcp-registry-auth` on avakit.dev.
