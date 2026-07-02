# create-avalanche-app

Scaffold a batteries-included [AvaKit](https://github.com/mericcintosun/AvaKit) Avalanche dapp: social-login onboarding, deploy-ready, and AI-native.

## Usage

```bash
npm create avalanche-app@latest
# or
npm create avalanche-app@latest my-app -- --template nft-mint --yes
```

The CLI prints the exact next steps for your choices (they vary by template and wallet). Typically:

```bash
cd my-app
pnpm install
cp .env.example .env.local   # ONLY for social login (Web3Auth); injected scaffolds omit this file
# devnet templates only — start the local Avalanche network first:
pnpm run devnet              # icm-messenger   (or: pnpm run l1 / pnpm run bridge)
pnpm dev                     # http://localhost:3000
```

## Templates

| Template | What you get |
| --- | --- |
| `minimal` | Social-login wallet, balance, and a first transaction |
| `nft-mint` | Deploy an ERC-721 from the browser, then mint |
| `token-gated-app` | Unlock content for holders of an access-pass NFT |
| `erc20-token` | Deploy an ERC-20, mint supply, and transfer |
| `icm-messenger` | Send a message between two Avalanche L1s over Interchain Messaging, on a one-command local devnet |
| `eerc-token` | Register, mint, and privately transfer tokens with hidden balances (Encrypted ERC) |
| `l1-launch` | Launch your own Avalanche L1 with one command, then explore it in a built-in dashboard |
| `token-bridge` | Bridge an ERC-20 between two Avalanche L1s with Interchain Token Transfer (ICTT) |

Every generated app ships **shadcn/ui** (neutral/grayscale with dark/light from day one), a social-login wallet via `@avakit/react`, and AI context files (`CLAUDE.md`, `llms.txt`, `.cursor/rules`) so Claude Code / Cursor understand the project out of the box.

The `icm-messenger`, `l1-launch`, and `token-bridge` templates run a local devnet via `avalanche-cli`, so they need a Unix-like shell (macOS, Linux, or **WSL2** on Windows). The other five are pure Fuji and work on native Windows too.

## Options

```
-t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token |
                        icm-messenger | eerc-token | l1-launch | token-bridge
-w, --wallet <id>       web3auth | injected      (default: web3auth)
-c, --chain <id>        fuji | c-chain           (default: fuji)
    --pm <manager>      pnpm | npm | yarn | bun
-y, --yes               skip prompts (non-interactive)
    --no-install        do not install dependencies
```

MIT © AvaKit contributors
