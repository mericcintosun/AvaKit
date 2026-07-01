# create-avalanche-app

Scaffold a batteries-included [AvaKit](https://github.com/avakit/avakit) Avalanche dapp: social-login onboarding, deploy-ready, and AI-native.

## Usage

```bash
npm create avalanche-app@latest
# or
npm create avalanche-app@latest my-app -- --template nft-mint --yes
```

Then:

```bash
cd my-app
pnpm install
cp .env.example .env.local   # add a free Web3Auth client ID for social login
pnpm dev                     # http://localhost:3000
```

## Templates

| Template | What you get |
| --- | --- |
| `minimal` | Social-login wallet, balance, and a first transaction |
| `nft-mint` | Deploy an NFT contract from the browser, then mint |
| `token-gated-app` | Unlock content for holders of an access-pass NFT |

Every generated app ships **shadcn/ui** (black & white with dark/light from day one), a social-login wallet via `@avakit/react`, and AI context files (`CLAUDE.md`, `llms.txt`, `.cursor/rules`) so Claude Code / Cursor understand the project out of the box.

## Options

```
-t, --template <id>     minimal | nft-mint | token-gated-app
-w, --wallet <id>       web3auth | injected      (default: web3auth)
-c, --chain <id>        fuji | c-chain           (default: fuji)
    --pm <manager>      pnpm | npm | yarn | bun
-y, --yes               skip prompts (non-interactive)
    --no-install        do not install dependencies
```

MIT © AvaKit contributors
