# 09 — Spec: `@avakit/mcp`

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

**Role:** AI surface. An MCP server that lets Claude Code / Cursor / Claude Desktop scaffold + deploy + read on Avalanche using natural language.
**Milestone:** M3.
**Depends on:** `@avakit/core`, `create-avalanche-app`, `@modelcontextprotocol/sdk`.

## Why is this MCP different from the existing ones?
- `utkucy/avalanche-mcp-tools` → wraps the Avalanche **CLI** (subnet/L1/VM).
- Official MCP → **docs retrieval**.
- **AvaKit MCP → app setup + deploy + wire (action).** No one owns this angle (see [02](02-competitive-landscape.md)).

## Transport & setup
- stdio-based MCP server.
- Config examples for Claude Code / Cursor / Claude Desktop are documented:
```json
{
  "mcpServers": {
    "avakit": { "command": "npx", "args": ["-y", "@avakit/mcp"] }
  }
}
```

## Tool surface

### `scaffold_app`
Wraps `create-avalanche-app` non-interactively (`--yes`).
```
input:  { name, template, wallet, chain, directory, packageManager }
output: { path, filesCreated, nextSteps }
```
- Template/wallet/chain are validated against the manifest; if invalid, an explanatory error.

### `deploy_contract`
The `@avakit/core` deploy helper (ADR-005).
```
input:  { artifactPath | { abi, bytecode }, args?, chain, confirm? }
output: { address, txHash, explorerUrl }
```
- **`confirm: true` is required for mainnet** + a balance check (ADR-007). Otherwise the tool refuses and explains why it is needed.

### `read_chain`
```
input:  { action: 'balance' | 'tx' | 'contractRead', params }
output: the relevant data (bigints stringified, JSON-safe)
```

### `get_context`
```
input:  { topic? }
output: { markdown }   // relevant context from the official llms.txt + AvaKit docs summary
```
- **Consumes** the official Avalanche `llms.txt` (does not write its own docs); adds AvaKit-specific context.

### `list_templates` (helper)
```
output: [{ name, description, supports }]   // from the manifests
```

## Design principles (AI ergonomics)
- **Idempotent:** Same input → same result; warns before overwriting an existing file.
- **Actionable errors:** Not "RPC unreachable", but "Fuji RPC timed out; check the faucet/clientId: <link>".
- **Small, composable tools:** The agent chains them (`scaffold_app` → `deploy_contract` → `read_chain`).
- **Safe defaults:** chain=fuji, mainnet always explicit + confirm.
- **Transparent side effects:** Which files were written/changed is listed in the output.

## Security
- The MCP never touches the private key; the deploy signature comes from the user's local environment/adapter.
- Mainnet and fund-spending operations require explicit confirmation.
- Secrets (clientId, RPC key) are never written to logs or tool output.

## Example end-to-end scenario (J1)
```
User: "Set up an nft-mint dapp on Avalanche and deploy it to Fuji."
  → scaffold_app({ template: 'nft-mint', wallet: 'web3auth', chain: 'fuji' })
  → deploy_contract({ artifactPath: 'contracts/out/NFT.sol/NFT.json', chain: 'fuji' })
  → get_context({ topic: 'run-dev-server' })  → gives the user the "pnpm dev" instruction
Result: Google login + mint in the browser. < 5 min.
```

## Acceptance criterion (M3)
A natural-language command in Claude Code completes scaffold → deploy → a running dev server end to end; mainnet operations are refused without confirmation.

Related: [Scaffolder Spec](08-spec-scaffolder.md) · [AI-Native](10-ai-native-strategy.md) · [ADR-005](04-adr.md)
