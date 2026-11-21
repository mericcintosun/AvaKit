---
"@avakit/studio": patch
---

Stopping Studio (Ctrl+C, SIGTERM, a closed terminal, or an agent's client closing `avakit-studio mcp`) now stops the avalanche-cli command it started and waits for it before exiting, then says which local L1s keep running and how to stop them; Interchain transactions are signed inside Studio with the public EWOQ devnet key, which no longer appears on any command line and is refused for an RPC URL that is not on this machine or that answers for another chain, so the Interchain view no longer needs Foundry; and the Devnet, Launch on Fuji and Interchain views and their MCP tools are labeled experimental.
