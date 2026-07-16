# create-avalanche-app

Scaffold a batteries-included [AvaKit](https://github.com/mericcintosun/AvaKit) Avalanche dapp: social-login onboarding, deploy-ready, and AI-native.

## Usage

```bash
npm create avalanche-app@latest
# or
npm create avalanche-app@latest my-app -- --template nft-mint --yes
```

The CLI prints the exact next steps for your choices (they vary by template). Typically:

```bash
cd my-app
pnpm install
# Optional: social login works on localhost via a bundled demo key. Only your own
# deployment needs a client id — then copy .env.example and add it:
cp .env.example .env.local
# devnet templates only — start the local Avalanche network first:
pnpm run devnet              # icm-messenger   (or: pnpm run l1 / pnpm run bridge)
pnpm dev                     # http://localhost:3000
```

## Templates

| Template | What you get |
| --- | --- |
| `minimal` | A wallet (burner + social login + injected), balance, and a first transaction |
| `nft-mint` | Deploy an ERC-721 from the browser, then mint |
| `token-gated-app` | Unlock content for holders of an access-pass NFT |
| `erc20-token` | Deploy an ERC-20, mint supply, and transfer |
| `icm-messenger` | Send a message between two Avalanche L1s over Interchain Messaging, on a one-command local devnet |
| `eerc-token` | Register, mint, and privately transfer tokens with hidden balances (Encrypted ERC) |
| `l1-launch` | Launch your own Avalanche L1 with one command, then explore it in a built-in dashboard |
| `token-bridge` | Bridge an ERC-20 between two Avalanche L1s with Interchain Token Transfer (ICTT) |

Every generated app ships **shadcn/ui** (neutral/grayscale with dark/light from day one), a wallet chooser via `@avakit/react` (a zero-setup burner up front, plus social login and Core/MetaMask), and AI context files (`CLAUDE.md`, `llms.txt`, `.cursor/rules`) so Claude Code / Cursor understand the project out of the box.

The `icm-messenger`, `l1-launch`, and `token-bridge` templates run a local devnet via `avalanche-cli`, so they need a Unix-like shell (macOS, Linux, or **WSL2** on Windows). The other five are pure Fuji and work on native Windows too.

## Options

```
-t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token |
                        icm-messenger | eerc-token | l1-launch | token-bridge
-c, --chain <id>        fuji | c-chain           (default: fuji)
    --pm <manager>      pnpm | npm | yarn | bun
-y, --yes               skip prompts (non-interactive)
    --no-install        do not install dependencies
    --no-telemetry      opt out of anonymous usage counting (persisted)
    --telemetry         opt back in (persisted)
```

## Telemetry

This CLI counts scaffolds anonymously so we can show the Avalanche ecosystem that
it gets used. It's on by default, it tells you on the first run, and it's one env
var to turn off:

```bash
export AVAKIT_TELEMETRY_DISABLED=1   # or DO_NOT_TRACK=1, or --no-telemetry
```

**Sent:** which template, chain, and package manager you picked, the CLI
version, your OS and Node major, whether the scaffold succeeded, and a random id
generated on your machine (so we can tell ten people apart from ten runs).

**Never sent:** your project name, any file path, any code, any environment
variable, or the text of an error. No IP is stored by the collector.

It's off automatically in CI, and it can never fail or slow down a scaffold —
worst case it gives up after 1.5s. The collector is
[open source](https://github.com/mericcintosun/AvaKit/tree/main/services/telemetry)
and what it counts is public at [avakit.dev/stats](https://avakit.dev/stats).
Full details: [avakit.dev/docs/telemetry](https://avakit.dev/docs/telemetry).

## Notes

- When you scaffold with `--pm pnpm` (the default) and let the CLI install, it uses its own
  bundled **pnpm 11**, so the generated `pnpm-lock.yaml` is a pnpm-11 lockfile even if your system
  pnpm is 10. If your team pins pnpm 10, run `pnpm install` yourself after `--no-install`.
- Each template ships a `pnpm-workspace.yaml` that pre-approves native builds (e.g. `sharp`) and
  exempts `@avakit/*` from pnpm's supply-chain age gate, so `pnpm install` is clean out of the box.

MIT © AvaKit contributors
