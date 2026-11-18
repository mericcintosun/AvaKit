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
| `list_templates` | List available templates, with the chains each one supports |
| `read_chain` | Read a balance, a transaction receipt, or a contract view function |
| `deploy_contract` | Deploy compiled bytecode (Fuji by default; mainnet requires `confirm: true`) |
| `estimate_gas` | Estimate gas for a call before you send it |
| `get_context` | AvaKit + Avalanche coding context and doc links |

## Scaffolding

**Templates and chains.** `scaffold_app` takes a `chain`, `fuji` by default. A template can only
be scaffolded for the chains `list_templates` reports for it: `minimal` also supports `c-chain`
(mainnet), every other template is Fuji-only. Any other combination is refused with a message that
names the chains the template supports.

**Where projects are created.** `scaffold_app` creates the project inside the directory the server
was started in — in Claude Code and Cursor, your workspace. The optional `directory` argument picks
a sub-directory of it. A path outside (an absolute path elsewhere, or one that climbs out with
`..`, directly or through a symlink) is refused, so an agent acting on a malicious prompt cannot
plant a project somewhere else on your disk.

To create projects somewhere else — for example with Claude Desktop, which does not start servers
inside a project folder — name that directory in the server's environment:

```json
{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": { "AVAKIT_MCP_ROOT": "/Users/you/projects" }
    }
  }
}
```

Projects then go under `AVAKIT_MCP_ROOT` instead of the working directory. Only whoever configures
the server can set it; a tool caller cannot.

## Deploy key

`deploy_contract` signs with a private key from the `AVAKIT_DEPLOYER_KEY` environment variable. Use a **throwaway testnet key** — never a key holding real funds. Mainnet deploys require an explicit `confirm: true`.

MIT © AvaKit contributors
