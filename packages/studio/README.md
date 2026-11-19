# @avakit/studio

A local control center for Avalanche development — L1s, Interchain Messaging, devnets, and on-chain data — in your browser.

```bash
npx @avakit/studio
```

It starts a small server on `127.0.0.1`, opens your browser, and gives you six views:

- **Overview** — your toolchain, project, and network at a glance.
- **Devnet** — spin up two local L1s with Interchain Messaging and a relayer, launch your own L1, start/stop the network, with a **live log** streamed from avalanche-cli.
- **Launch on Fuji** — create your own L1 on the Fuji testnet and watch it come up, without touching the CLI.
- **Interchain** — deploy messengers and watch a message (up to 256 bytes) travel between any two running L1s.
- **Data** — balances, NFTs, and transactions for any Fuji or C-Chain address (AvaCloud Data API, no indexer).
- **Environment** — the tools and project detected on this machine.

avalanche-cli actions run **one at a time** and belong to the Studio server, not to the browser tab: an action keeps running if you switch views, reload, or close the tab, and the page picks its log up again when you come back. Use **Cancel** on the console to stop one. The one-at-a-time rule holds across every Studio process on the machine: the dashboard and the MCP server share a lock file (`~/.avakit-studio/action.lock`, removed when the action ends), so an agent's action and a click in the dashboard never run at once — the second one is refused with "Another action (…) is still running". Deploying the Interchain messengers and sending a message take the same lock, so they never overlap with each other or with a devnet start or stop.

The avalanche-cli command an action runs is started in its own process group, so stopping Studio (Ctrl+C, or an agent's client ending the MCP server) never kills a `network start` half-way. Such a command can outlive the Studio that started it, so the lock file also names the command, and it stays in place until the command has finished: until then every other action is refused with a message that says which command is still running and which Studio process (now gone) started it. A lock counts as held only while the Studio process or the command it names is still running — the same process, not just the same pid: on macOS and Linux the lock records when each process started, so a pid that was reused after a crash does not keep the lock. (On Windows the pid alone decides.) Every refusal from another Studio process names the lock file's full path: if no Studio and no avalanche-cli command is running, the file is left over from a crash and you can delete it.

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

- [Avalanche CLI](https://github.com/ava-labs/avalanche-cli) (the `avalanche` command) for the Devnet, Launch on Fuji and Interchain views (Studio detects it and shows the install command if missing).
- [Foundry](https://getfoundry.sh) (`cast`) for the Interchain view.

The Data and Environment views work without either.

## Tooling status

To create, start and stop devnets and L1s, Studio runs Avalanche CLI and reads what it prints. What to know before you rely on it:

- Ava Labs put Avalanche CLI in maintenance mode in December 2025, and on 2026-10-06 removed its pages from the Avalanche documentation in favour of Platform CLI.
- The Devnet, Launch on Fuji and Interchain views were last proven end to end in July 2026. Studio has changed since then (see `CHANGELOG.md`), and the changed version is covered by unit tests with a stand-in for the CLI, not by a full run against a live network. Another CLI version may print something Studio does not expect.
- Moving Studio to the supported toolchain has not been done.

## Why it's safe

Studio is a tool **you launch yourself** from your terminal (like Prisma Studio). It:

- binds to `127.0.0.1` only — never reachable from the network,
- validates the `Host` header (defends DNS rebinding),
- gates its API behind a per-session token injected into the served page (a cross-origin page can't read it),
- refuses to be embedded in a frame, and starts an action only from a `POST` (never a `GET`),
- runs external tools only via `spawn`/`execFile` with argument arrays — never a shell string, so there's no command injection. The few request-derived values that can reach an argument (an L1's name, chain id and token symbol, a transfer amount) are validated first. The text of an Interchain message never reaches a command line at all: Studio checks its length, ABI-encodes it, and hands `cast` only the resulting hex, after a `--`.

MIT © AvaKit contributors
