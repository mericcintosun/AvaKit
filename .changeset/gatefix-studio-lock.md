---
"@avakit/studio": patch
---

Stopping Studio (Ctrl+C, or an agent's client ending `avakit-studio mcp`) while an avalanche-cli command it started is still running no longer frees the action lock: the command keeps running, as before, and every other Studio refuses new actions until it has finished, saying which command is still running. Deploying the Interchain messengers and sending a message now take the same lock, so they can no longer overlap with each other, across the dashboard and the MCP server, or with a devnet start or stop. A lock left by a crashed Studio whose pid now belongs to another process no longer blocks anything, and every refusal from another Studio names the lock file and says when it is safe to delete it.
