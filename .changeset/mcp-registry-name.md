---
"@avakit/mcp": patch
---

Rename the registry listing to `dev.avakit/avalanche`.

The official MCP Registry's search matches server names, not descriptions — measured: a word that appears only in our description returns zero results. Under the previous name the server was invisible to the one query that matters, `avalanche`, where the only hit is a community docs-only wrapper. No runtime change; the npm package, tools, and config are untouched.
