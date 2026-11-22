# @avakit/studio

A local control center for Avalanche development — L1s, Interchain Messaging, devnets, and on-chain data — in your browser.

```bash
npx @avakit/studio
```

It starts a small server on `127.0.0.1`, opens your browser, and gives you six views:

- **Overview** — your toolchain, project, and network at a glance.
- **Devnet** (experimental) — spin up two local L1s with Interchain Messaging and a relayer, launch your own L1, start/stop the network, with a **live log** streamed from avalanche-cli.
- **Launch on Fuji** (experimental) — create your own L1 on the Fuji testnet and watch it come up, without touching the CLI.
- **Interchain** (experimental) — deploy messengers and watch a message (up to 256 bytes) travel between any two running L1s.
- **Data** — balances, NFTs, and transactions for any Fuji or C-Chain address (AvaCloud Data API, no indexer).
- **Environment** — the tools and project detected on this machine.

The three views marked experimental depend on Avalanche CLI; see [Experimental: the Avalanche CLI views](#experimental-the-avalanche-cli-views).

avalanche-cli actions run **one at a time** and belong to the Studio server, not to the browser tab: an action keeps running if you switch views, reload, or close the tab, and the page picks its log up again when you come back. Use **Cancel** on the console to stop one. The one-at-a-time rule holds across every Studio process on the machine: the dashboard and the MCP server share a lock file (`~/.avakit-studio/action.lock`, removed when the action ends), so an agent's action and a click in the dashboard never run at once — the second one is refused with "Another action (…) is still running". Deploying the Interchain messengers and sending a message take the same lock, so they never overlap with each other or with a devnet start or stop.

Options: `--port <n>` (default: a free port), `--no-open` (don't open the browser).

## Stopping Studio

Studio stops everything it started before it exits: on Ctrl+C, on `SIGTERM`, when its terminal closes, and, for the MCP server, when the agent's client closes the connection. The avalanche-cli command in flight gets `SIGTERM`, as from the **Cancel** button, then `SIGKILL` if it is still running 5 seconds later. Either signal goes to the command's whole process group, so whatever the command started and still runs in that group stops with it, as a Ctrl+C on the command in a terminal would do. A second Ctrl+C kills it at once. Studio waits for it to exit, says what it stopped, and only then exits, so the action lock goes with it. It does all of this even when nothing reads what it says any more, as after the terminal window was closed or the agent's client was killed: only the messages are lost.

The **local Avalanche network stays up**, on purpose. It belongs to avalanche-cli, not to Studio: your app, a terminal or another Studio may be using it, and stopping it from Studio's exit could pull it out from under them. So Studio says, as it exits, which local L1s are still answering and how to stop them:

```text
The local Avalanche network keeps running. Studio leaves it up on purpose, because your apps and other tools may be using it:
  chain1  http://127.0.0.1:9650/ext/bc/…/rpc
Stop it with: avalanche network stop   (its state is kept: avalanche network start brings it back)
```

Stop it whenever you like with **Stop network** in the Devnet view, the `devnet_stop` tool, or `avalanche network stop`. The same goes for a Fuji L1 you launched with **Launch on Fuji**: its validator node runs on this machine and keeps running, since the L1 produces blocks only while it does.

Only a Studio that is killed outright (`SIGKILL`, a crash) can leave an avalanche-cli command running: the command runs in its own process group, so it is not killed with Studio. The lock file then names that command too, and stays in place until the command has finished: until then every other action is refused with a message that says which command is still running and which Studio process (now gone) started it. A lock counts as held only while the Studio process or the command it names is still running — the same process, not just the same pid: on macOS and Linux the lock records when each process started, so a pid that was reused after a crash does not keep the lock. (On Windows the pid alone decides.) Every refusal from another Studio process names the lock file's full path: if no Studio and no avalanche-cli command is running, the file is left over from a crash and you can delete it.

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

The `devnet_*` and `icm_*` tools are experimental, like the views they mirror: their titles say so, and so do the instructions the server gives the agent when it connects.

## Requirements

- [Avalanche CLI](https://github.com/ava-labs/avalanche-cli) (the `avalanche` command) for the Devnet, Launch on Fuji and Interchain views (Studio detects it and shows the install command if missing).

From 0.1.15, nothing else: the Interchain view talks to each local L1's RPC itself (0.1.14 and earlier need Foundry's `cast` for it). The Environment view also reports [Foundry](https://getfoundry.sh) (`forge`, `cast`) for your own contracts, and the Data and Environment views work without Avalanche CLI.

## Experimental: the Avalanche CLI views

To create, start and stop devnets and L1s, Studio runs Avalanche CLI and reads what it prints. The Interchain view runs no CLI command, but it works on the local L1s the CLI set up, from the files the CLI keeps about them. That makes the Devnet, Launch on Fuji and Interchain views, and the tools that mirror them, experimental. What to know before you rely on them:

- Ava Labs put Avalanche CLI in maintenance mode in December 2025, and on 2026-10-06 removed its pages from the Avalanche documentation in favour of Platform CLI.
- The Devnet, Launch on Fuji and Interchain views were last proven end to end in July 2026. Studio has changed since then (see `CHANGELOG.md`; the Interchain view, for one, now signs its transactions inside Studio instead of with `cast`), and the changed version is covered by unit tests with stand-ins for the CLI and its L1s, not by a full run against a live network. Another CLI version may print something Studio does not expect.
- Moving Studio to the supported toolchain has not been done.

## Why it's safe

Studio is a tool **you launch yourself** from your terminal (like Prisma Studio). It:

- binds to `127.0.0.1` only — never reachable from the network,
- validates the `Host` header (defends DNS rebinding),
- gates its API behind a per-session token injected into the served page (a cross-origin page can't read it),
- refuses to be embedded in a frame, and starts an action only from a `POST` (never a `GET`),
- runs external tools only via `spawn`/`execFile` with argument arrays — never a shell string, so there's no command injection. The few request-derived values that can reach an argument (an L1's name, chain id and token symbol, a transfer amount) are validated first. The text of an Interchain message never reaches a command line at all: Studio checks its length, ABI-encodes it, and sends it to the L1 itself,
- signs Interchain transactions with **EWOQ**, the well-known public key avalanche-cli funds on every local network. Anyone can read that key, so it holds nothing of value, and from 0.1.15 Studio keeps it local (0.1.14 and earlier pass it, and the encoded message, to `cast` on the command line): it signs in its own process, so the key is never on a command line where other processes could read it, and it signs only for an L1 whose RPC URL is on this machine (`localhost`, `127.0.0.0/8` or `::1`) and, when avalanche-cli recorded a chain ID for that L1, answers for that chain ID. It never follows a redirect from that RPC. Anything else is refused before a transaction is built,
- stops what it started when it stops (see [Stopping Studio](#stopping-studio)).

MIT © AvaKit contributors
