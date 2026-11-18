# create-avalanche-app

Scaffold a batteries-included [AvaKit](https://github.com/mericcintosun/AvaKit) Avalanche dapp: social-login onboarding, deploy-ready, and AI-native.

## Usage

```bash
npm create avalanche-app@latest
# or
npm create avalanche-app@latest my-app -- --template nft-mint --yes
```

Use the package manager you prefer (`pnpm create`, `yarn create`, and `bun create` work the same
way): the CLI installs the dependencies with the one you launched it with, or with the one you
name with `--pm`.

It then prints the exact next steps for your choices (they vary by template). With npm, typically:

```bash
cd my-app
# Optional: social login works on localhost via a bundled demo key. Only your own
# deployment needs a client id — then copy .env.example and add it:
cp .env.example .env.local
# devnet templates only — start the local Avalanche network first:
npm run devnet               # icm-messenger   (or: npm run l1 / npm run bridge)
npm run dev                  # http://localhost:3000
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

## Networks

`--chain` (the "Network" step in the wizard) picks the chain the generated app is wired to. Each
template lists the chains it supports in its `manifest.json`:

| Template | `fuji` (default) | `c-chain` (mainnet) |
| --- | :---: | :---: |
| `minimal` | yes | yes |
| `nft-mint` | yes | no |
| `token-gated-app` | yes | no |
| `erc20-token` | yes | no |
| `eerc-token` | yes | no |
| `icm-messenger` | yes — runs on a local devnet | no |
| `l1-launch` | yes — runs on a local devnet | no |
| `token-bridge` | yes — runs on a local devnet | no |

Asking for a chain a template does not list is refused — by the CLI, by the wizard (which only
offers the supported networks), and by the programmatic API that `@avakit/mcp`'s `scaffold_app`
uses — with a message naming the chains the template does support. A template whose manifest has
no `chains` entry is Fuji-only.

AvaKit is testnet-first, so mainnet is something you opt into deliberately:

- `minimal` is the only template that can be scaffolded straight onto C-Chain.
- The templates that deploy a contract from the browser (`nft-mint`, `token-gated-app`,
  `erc20-token`) are Fuji-only because a mainnet deploy needs an explicit confirmation that the
  generated apps do not ask for. Build and test on Fuji; to go to mainnet, change the chain in
  `app/providers.tsx` and pass `{ confirmMainnet: true }` as the third argument of `deploy()` once
  you have added your own confirmation step.
- `eerc-token` talks to an Encrypted ERC instance that exists on Fuji only.
- `icm-messenger`, `l1-launch`, and `token-bridge` run against the local devnet their setup script
  starts and never read `--chain`; the default (`fuji`) is the only value they accept.

## Options

```
-t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token |
                        icm-messenger | eerc-token | l1-launch | token-bridge
-c, --chain <id>        fuji | c-chain           (default: fuji)
                        c-chain (mainnet) only with: minimal
    --pm <manager>      pnpm | npm | yarn | bun
                        (default: the one you ran this with, else npm)
-y, --yes               skip prompts (non-interactive)
    --no-install        do not install dependencies
    --no-telemetry      opt out of anonymous usage counting (persisted)
    --telemetry         opt back in (persisted)
```

Anything the CLI does not recognise — a mistyped flag, an unknown template, chain or package
manager, an unsafe project name — is an error that lists the valid values and exits with status 1.
It is never replaced with a default.

## Telemetry

This CLI counts scaffolds anonymously so we can show the Avalanche ecosystem that
it gets used. It's on by default, it tells you on the first run, and it's one env
var to turn off:

```bash
export AVAKIT_TELEMETRY_DISABLED=1   # or DO_NOT_TRACK=1, or --no-telemetry
```

`--no-telemetry` is remembered: it writes `{"enabled": false}` to `~/.config/avakit/config.json`
(`%APPDATA%\avakit\config.json` on Windows). Writing that file yourself — from a provisioning
script, say — opts out just the same.

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

- **Package manager.** Without `--pm`, the CLI uses the package manager you launched it with
  (`npm create` → npm, `pnpm create` → pnpm, `yarn create` → yarn, `bun create` → bun) and falls
  back to npm when it cannot tell. It runs that manager from your `PATH` — nothing is bundled — so
  the lockfile is whatever your installed version writes. To control the install yourself, pass
  `--no-install`.
- **A failed install is an error.** If the package manager is missing or the install fails, the
  project is still created, but the CLI says what went wrong, prints the commands to run by hand,
  and exits with a non-zero status, so a script never carries on with a half-set-up app.
- Each template ships a `pnpm-workspace.yaml` that pre-approves native builds (e.g. `sharp`) and
  exempts `@avakit/*` from pnpm's supply-chain age gate, so `pnpm install` is clean out of the box.
  Other package managers ignore that file.

MIT © AvaKit contributors
