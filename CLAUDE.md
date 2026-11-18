# CLAUDE.md — AvaKit

Guidance for AI agents (Claude Code / Cursor) working in this repository.

## What this is

**AvaKit** — an open-source, AI-native Avalanche developer toolkit: one core with surfaces (`@avakit/core`, `@avakit/react`, `create-avalanche-app`, `@avakit/mcp`, plus the `@avakit/studio` local dashboard). Positioning: "Avalanche's open-source, AI-native `create-next-app`." Strategy: **wrap mature pieces, don't rewrite them.** See `README.md` and `docs/00`–`docs/11`.

Current state: **0.x pre-release, shipped.** All five packages are published on npm and proven live on Fuji; 8 templates ship. APIs may still change before 1.0. (The `docs/00`–`docs/10` planning specs predate the build and are partly stale — treat the code, `README.md`, and the website docs as the source of truth.)

## Binding rules (do not violate)

These come from the project owner and override convenience. Full text in `docs/11-conventions.md`.

1. **Language:** Everything written into the repo is **English** (code, comments, commits, docs). Conversation with the owner is Turkish, but no Turkish goes into project files.
2. **UI library:** **shadcn/ui ONLY.** No other component library — and **not** BuilderKit's UI. Avalanche-specific components are built on shadcn primitives.
3. **Animation:** **Framer Motion or GSAP only.**
4. **Color:** The "black & white until M3" rule is **lifted** (owner, 2026-07). The **website (`apps/web`)** now uses a brand color — **"Ember Crimson"** (a distinct crimson that evokes Avalanche's red/dark energy without copying it). Surfaces stay near-black/white; crimson is an accent (primary buttons, focus rings, links, eyebrow ticks, `$`/checkmarks). **Dark/light wired from day one** (`next-themes`), both fully supported. Colors live only in `apps/web/app/globals.css` design tokens — components never hardcode them. Keep the **scaffolder templates visually neutral/grayscale** (users brand their own apps) unless the owner says otherwise.
5. **Design:** 2026-modern, professional devtools aesthetic (Linear / Vercel / shadcn-dashboard polish).
6. **Versions:** **Latest stable** of every frontend tech (e.g. Next.js 16, React 19, Tailwind v4). Re-check "latest stable" at implementation time.

## Tech decisions (see docs/04-adr.md)

- Wallets: every scaffold wires several adapters; there is no per-scaffold choice (the `--wallet` flag is gone). All eight templates wire the **burner** (a temporary in-browser testnet wallet — the zero-setup option the connect dialog leads with) and **injected** (Core/MetaMask); the five Fuji templates add **Web3Auth** social login (`@avakit/core/web3auth`). **Coinbase Smart Wallet** (`@avakit/core/coinbase`) is an opt-in adapter that no template wires. There is **no AvaCloud WaaS adapter**: ADR-001 planned one and it was never built.
- Monorepo: **pnpm workspaces + Turborepo + Changesets**.
- Frontend: **Next.js (App Router) + React + viem + Tailwind + shadcn/ui** (+ Framer Motion/GSAP). **No wagmi** (ADR-011) — the one exception is the `eerc-token` template, whose eERC SDK requires wagmi 2.x.
- Contracts: **Foundry** (primary), Hardhat optional.
- MCP: `@modelcontextprotocol/sdk` (stdio).
- License: **MIT**. Chains: **testnet-first (Fuji)**, mainnet opt-in + confirm.

## Guardrails

- Never write private keys/secrets into code or logs; use env. Key management lives in the wallet provider (HSM/enclave), never in AvaKit code — **with one deliberate exception**: `burnerAdapter()` generates a throwaway testnet key in the browser and persists it to `localStorage` in the clear. That is the zero-setup demo path only; never extend it to hold real value. See `SECURITY.md`.
- Never deploy to mainnet without explicit confirmation + balance check.
- Keep `@avakit/core` framework-agnostic (viem only, no React). React-specific code lives in `@avakit/react`.
- No circular dependencies; dependency direction is core ← react ← cli ← mcp.

## Where things live

- `packages/core`, `packages/react`, `packages/mcp`, `packages/studio`, `packages/create-avalanche-app` — the five published packages
- `packages/create-avalanche-app/templates/*` — the eight scaffolder templates (each with a `manifest.json` + `CLAUDE.md`/`llms.txt`). There is no top-level `templates/` directory.
- `apps/web` — the avakit.dev website (private, not published)
- `examples/*` — live demo dapps
- `services/*` — the faucet and telemetry Cloudflare Workers (standalone npm projects, outside the pnpm workspace)
- `contracts-ci/` — Foundry tests and the artifact check for the Solidity the repo ships
- `docs/*` — planning & spec docs (read these before implementing)
