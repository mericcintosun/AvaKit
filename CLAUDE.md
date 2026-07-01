# CLAUDE.md — AvaKit

Guidance for AI agents (Claude Code / Cursor) working in this repository.

## What this is

**AvaKit** — an open-source, AI-native Avalanche developer toolkit: one core with three surfaces (`@avakit/core`, `@avakit/react`, `create-avalanche-app`, `@avakit/mcp`). Positioning: "Avalanche's open-source, AI-native `create-next-app`." Strategy: **wrap mature pieces, don't rewrite them.** See `README.md` and `docs/00`–`docs/11`.

Current state: **planning phase** — docs only, no code yet. Implementation starts at milestone M0/M1 (see `docs/05-roadmap.md`).

## Binding rules (do not violate)

These come from the project owner and override convenience. Full text in `docs/11-conventions.md`.

1. **Language:** Everything written into the repo is **English** (code, comments, commits, docs). Conversation with the owner is Turkish, but no Turkish goes into project files.
2. **UI library:** **shadcn/ui ONLY.** No other component library — and **not** BuilderKit's UI. Avalanche-specific components are built on shadcn primitives.
3. **Animation:** **Framer Motion or GSAP only.**
4. **Color:** **Black and white only** until all three milestones (M1–M3) ship. **Dark/light theme wired from day one** (`next-themes`). Color is added last.
5. **Design:** 2026-modern, professional devtools aesthetic (Linear / Vercel / shadcn-dashboard polish, minus color for now).
6. **Versions:** **Latest stable** of every frontend tech (e.g. Next.js 16, React 19, Tailwind v4). Re-check "latest stable" at implementation time.

## Tech decisions (see docs/04-adr.md)

- Default wallet: **Web3Auth** (social login). Opt-in: AvaCloud WaaS, Injected (Core/MetaMask).
- Monorepo: **pnpm workspaces + Turborepo + Changesets**.
- Frontend: **Next.js (App Router) + React + wagmi + viem + Tailwind + shadcn/ui** (+ Framer Motion/GSAP).
- Contracts: **Foundry** (primary), Hardhat optional.
- MCP: `@modelcontextprotocol/sdk` (stdio).
- License: **MIT**. Chains: **testnet-first (Fuji)**, mainnet opt-in + confirm.

## Guardrails

- Never write private keys/secrets into code or logs; use env. Key management lives in the wallet provider (HSM/enclave), never in AvaKit code.
- Never deploy to mainnet without explicit confirmation + balance check.
- Keep `@avakit/core` framework-agnostic (viem only, no React). React-specific code lives in `@avakit/react`.
- No circular dependencies; dependency direction is core ← react ← cli ← mcp.

## Where things live (planned)

- `packages/core`, `packages/react`, `packages/mcp`, `packages/create-avalanche-app`
- `templates/*` — scaffolder templates (each with a `manifest.json` + `CLAUDE.md`/`llms.txt`)
- `examples/*` — live demo dapps
- `docs/*` — planning & spec docs (read these before implementing)
