# @avakit/studio

A local control center for Avalanche development — L1s, Interchain Messaging, devnets, and on-chain data — in your browser.

```bash
npx @avakit/studio
```

It starts a small server on `127.0.0.1`, opens your browser, and gives you five views:

- **Overview** — your toolchain, project, and network at a glance.
- **Devnet** — spin up two local L1s with Interchain Messaging and a relayer, start/stop the network, with a **live log** streamed from avalanche-cli.
- **Interchain** — deploy messengers and watch a message travel from one L1 to the other.
- **Data** — balances, NFTs, and transactions for any Fuji or C-Chain address (AvaCloud Data API, no indexer).
- **Environment** — the tools and project detected on this machine.

## Drive it from an AI agent

Studio is also an MCP server — point Claude Code or Cursor at it to run the same actions agent-side:

```json
{
  "mcpServers": {
    "avakit-studio": { "command": "npx", "args": ["-y", "@avakit/studio", "mcp"] }
  }
}
```

Tools: `avalanche_env`, `devnet_status`, `devnet_spin_up`, `devnet_start`, `devnet_stop`, `icm_state`, `icm_deploy_messengers`, `icm_send`, `data_lookup`.

## Requirements

- [avalanche-cli](https://build.avax.network/docs/tooling/avalanche-cli/get-avalanche-cli) for devnet control (Studio detects it and shows the install command if missing).
- [Foundry](https://getfoundry.sh) (`cast`) for the Interchain view.

## Why it's safe

Studio is a tool **you launch yourself** from your terminal (like Prisma Studio). It:

- binds to `127.0.0.1` only — never reachable from the network,
- validates the `Host` header (defends DNS rebinding),
- gates its API behind a per-session token injected into the served page (a cross-origin page can't read it),
- runs external tools only via `spawn`/`execFile` with fixed arguments — never a shell string, so there's no command injection.

MIT © AvaKit contributors
