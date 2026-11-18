# @avakit/studio

A local control center for Avalanche development — L1s, Interchain Messaging, devnets, and on-chain data — in your browser.

```bash
npx @avakit/studio
```

It starts a small server on `127.0.0.1`, opens your browser, and gives you six views:

- **Overview** — your toolchain, project, and network at a glance.
- **Devnet** — spin up two local L1s with Interchain Messaging and a relayer, launch your own L1, start/stop the network, with a **live log** streamed from avalanche-cli.
- **Launch on Fuji** — create your own L1 on the Fuji testnet and watch it come up, without touching the CLI.
- **Interchain** — deploy messengers and watch a message travel between any two running L1s.
- **Data** — balances, NFTs, and transactions for any Fuji or C-Chain address (AvaCloud Data API, no indexer).
- **Environment** — the tools and project detected on this machine.

avalanche-cli actions run **one at a time** and belong to the Studio server, not to the browser tab: an action keeps running if you switch views, reload, or close the tab, and the page picks its log up again when you come back. Use **Cancel** on the console to stop one.

Options: `--port <n>` (default: a free port), `--no-open` (don't open the browser).

## Drive it from an AI agent

Studio is also an MCP server — point Claude Code or Cursor at it to run the same actions agent-side:

```json
{
  "mcpServers": {
    "avakit-studio": { "command": "npx", "args": ["-y", "@avakit/studio", "mcp"] }
  }
}
```

Tools: `avalanche_env`, `devnet_status`, `devnet_spin_up`, `devnet_launch_l1`, `devnet_start`, `devnet_stop`, `icm_state`, `icm_deploy_messengers`, `icm_send`, `data_lookup`.

## Requirements

- [avalanche-cli](https://build.avax.network/docs/tooling/avalanche-cli/get-avalanche-cli) for devnet control (Studio detects it and shows the install command if missing).
- [Foundry](https://getfoundry.sh) (`cast`) for the Interchain view.

## Why it's safe

Studio is a tool **you launch yourself** from your terminal (like Prisma Studio). It:

- binds to `127.0.0.1` only — never reachable from the network,
- validates the `Host` header (defends DNS rebinding),
- gates its API behind a per-session token injected into the served page (a cross-origin page can't read it),
- refuses to be embedded in a frame, and starts an action only from a `POST` (never a `GET`),
- runs external tools only via `spawn`/`execFile` with argument arrays — never a shell string, so there's no command injection. The few request-derived values that can reach an argument (an L1's name, chain id and token symbol, a transfer amount, an Interchain message) are validated first, and the message is handed to `cast` after a `--`, so it can never be read as an option.

MIT © AvaKit contributors
