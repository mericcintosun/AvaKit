# @avakit/mcp

The [AvaKit](https://github.com/mericcintosun/AvaKit) MCP server — scaffold, deploy, and read Avalanche from Claude Code / Cursor over the [Model Context Protocol](https://modelcontextprotocol.io).

Unlike docs-only servers, this exposes **actions**: it can create a dapp, deploy a contract, and read chain state.

Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io) as **`dev.avakit/avalanche`**.

## Add to your MCP client

```json
{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"]
    }
  }
}
```

Works with Claude Code, Cursor, and Claude Desktop.

## Tools

| Tool | Description |
| --- | --- |
| `scaffold_app` | Create an Avalanche dapp from any of the 8 templates (`list_templates` returns the current set) |
| `list_templates` | List available templates |
| `read_chain` | Read a balance, a transaction receipt, or a contract view function |
| `deploy_contract` | Deploy compiled bytecode (Fuji by default; mainnet requires `confirm: true`) |
| `estimate_gas` | Estimate gas for a call before you send it |
| `get_context` | AvaKit + Avalanche coding context and doc links |

## Deploy key

`deploy_contract` signs with a private key from the `AVAKIT_DEPLOYER_KEY` environment variable. Use a **throwaway testnet key** — never a key holding real funds. Mainnet deploys require an explicit `confirm: true`.

MIT © AvaKit contributors
