# Contributing to AvaKit

Thanks for your interest in AvaKit — the open-source, AI-native Avalanche developer toolkit.

## Prerequisites

- Node.js `>= 20.11` (see `.nvmrc` — repo targets Node 24)
- pnpm `>= 10` (`corepack enable` to get the pinned version)

## Setup

```bash
pnpm install
pnpm build       # build all packages (Turborepo)
pnpm test        # run package tests (Vitest)
pnpm lint        # Biome check (lint + format)
pnpm typecheck   # TypeScript, no emit
```

To run the web frontend:

```bash
pnpm --filter @avakit/web dev
```

## Repository layout

```
packages/
  core/                 @avakit/core — framework-agnostic kernel
  react/                @avakit/react — <ConnectAvalanche> + hooks (shadcn/ui)
  mcp/                  @avakit/mcp — MCP server
  studio/               @avakit/studio — local dev dashboard + MCP
  create-avalanche-app/ scaffolder CLI + 8 templates
apps/
  web/                  AvaKit web frontend (shadcn/ui baseline)
docs/                   planning, PRD, architecture, ADRs, specs
```

## Conventions (binding)

Read [`docs/11-conventions.md`](docs/11-conventions.md) before contributing. In short:

- **English** for everything in the repo (code, comments, commits, docs).
- **shadcn/ui only** for UI — no other component library.
- **Framer Motion / GSAP only** for animation.
- **Dark/light wired from day one** (`next-themes`); both must work. The website (`apps/web`) uses a brand accent ("Ember Crimson", in `globals.css` tokens only); keep the scaffolder templates neutral/grayscale.
- **Latest stable** versions of all frontend tech.

## Code style

- Formatting and linting are handled by **Biome** (`pnpm lint`, `pnpm format`). CI runs `biome check`.
- TypeScript everywhere; keep `@avakit/core` free of any React dependency.
- Never commit secrets or private keys. Key management belongs to the wallet provider, never to AvaKit code.

## Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning. When you change a published package, add a changeset:

```bash
pnpm changeset
```

## Roadmap

See [`docs/05-roadmap.md`](docs/05-roadmap.md). We build in vertical slices: M1 core + widget → M2 scaffolder → M3 MCP.
