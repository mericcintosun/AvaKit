# 08 — Spec: `create-avalanche-app`

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

**Role:** Batteries-included scaffolder. The vibe coder's single command. Produces a deployable dapp with embedded AI context that uses `@avakit/core` + `@avakit/react`.
**Milestone:** M2.

## Invocation

```bash
npm create avalanche-app@latest          # interactive
# or
pnpm create avalanche-app my-app --template token-gated-app --wallet web3auth --chain fuji --yes
```

## Interactive flow

```
◆  Project name? ……………………… my-avax-app
◆  Template?
   › minimal              (social login + connect + tx)
     token-gated-app      (content based on NFT/ERC-20 ownership)
     nft-mint             (mint flow + contract + deploy)
◆  Wallet provider?
   › web3auth   (free, social login — recommended)
     injected   (Core / MetaMask)
     avacloud   (WaaS — requires a client)
◆  Target chain?
   › fuji       (testnet — recommended)
     c-chain    (mainnet)
     custom L1  (asks for chainId + RPC)
◆  Package manager? … pnpm / npm / yarn / bun
◆  Install now? … yes
```

In `--yes` mode, all questions come from flags/defaults (required for CI and the MCP `scaffold_app`).

## Generated project structure (example: `token-gated-app`)

```
my-avax-app/
├── app/                      # Next.js App Router
│   ├── providers.tsx         # <AvaKitProvider> + ThemeProvider (next-themes)
│   ├── page.tsx              # <ConnectAvalanche> + token-gate example
│   └── layout.tsx
├── components/ui/            # shadcn/ui components (the only UI lib)
├── contracts/                # Foundry
│   ├── src/Token.sol
│   ├── script/Deploy.s.sol
│   └── foundry.toml
├── lib/avakit.ts             # chain + adapter config
├── .env.example              # WEB3AUTH_CLIENT_ID, RPC, etc.
├── CLAUDE.md                 # AI agent context (see doc 10)
├── llms.txt                  # AI-friendly project map
├── .cursor/rules/avakit.mdc  # Cursor rules
├── package.json              # scripts: dev, build, deploy:fuji
└── README.md                 # 3-step getting started
```

## `package.json` scripts (generated)
- `dev` — Next.js dev server.
- `deploy:fuji` — deploy the contract to Fuji with Foundry + write the address to `.env.local`.
- `deploy:mainnet` — C-Chain; **confirmation prompt** + balance check (ADR-007).
- `typegen` — type generation from the ABI.

## Post-generation user experience
```
✓ my-avax-app is ready.

Next steps:
  cd my-avax-app
  cp .env.example .env.local   # add WEB3AUTH_CLIENT_ID (free: dashboard link)
  pnpm deploy:fuji             # ship the example contract to testnet
  pnpm dev                     # http://localhost:3000

Tip: if you use Cursor/Claude, CLAUDE.md and .cursor/rules are already set up.
```

## AI context injection (the heart of the differentiation)
Automatically added to every generated project (see [doc 10](10-ai-native-strategy.md)):
- `CLAUDE.md` — project architecture, AvaKit APIs, common tasks, "don't do this" rules.
- `llms.txt` — file map + important entry points.
- `.cursor/rules/avakit.mdc` — the same context for Cursor.

## Template manifest
Each template ships with `templates/<name>/manifest.json`:
```json
{
  "name": "token-gated-app",
  "description": "Content lock based on NFT/ERC-20 ownership",
  "supports": { "wallet": ["web3auth", "injected", "avacloud"], "chains": ["fuji", "c-chain", "custom"] },
  "contracts": true,
  "postInstall": ["typegen"]
}
```
The CLI and MCP read this manifest to generate the options dynamically (adding a new template = folder + manifest).

## UI & theme (project rule — [doc 11](11-conventions.md))
- Every template ships with **shadcn/ui** + **Tailwind v4** + **next-themes**; a dark/light toggle is ready.
- **Black/white only** tokens until M3 is done; color comes last. Animation via Framer Motion.
- Latest stable versions (Next.js 16, React 19, etc.).

## Technical notes
- Templates are real files with placeholders (e.g. `__PROJECT_NAME__`), filled in during rendering.
- The wallet/chain selection shapes `lib/avakit.ts` and `.env.example`.
- The Hardhat variant (ADR-004) is a separate template or a `--contracts hardhat` flag.

## Acceptance criteria (M2)
`npm create avalanche-app` → `pnpm deploy:fuji` → `pnpm dev` yields a working social-login dapp with **zero manual code**; the example contract is on Fuji and read from the frontend.

Related: [Widget Spec](07-spec-wallet-widget.md) · [MCP Spec](09-spec-mcp.md) · [AI-Native](10-ai-native-strategy.md)
