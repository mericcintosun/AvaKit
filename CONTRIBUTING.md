# Contributing to AvaKit

Thanks for your interest in AvaKit — the open-source, AI-native Avalanche developer toolkit. Bug reports, docs fixes, new templates, and features are all welcome.

## Prerequisites

- **Node.js `>= 20.11`** (see `.nvmrc` — the repo targets Node 24 in CI).
- **pnpm `>= 10`** — run `corepack enable` to get the version pinned in `package.json` (`pnpm@10.20.0`).
- **Foundry** (optional) — only needed if you work on contract templates or regenerate bundled bytecode (see [Contracts and bytecode artifacts](#contracts-and-bytecode-artifacts)). Install with `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- **avalanche-cli** (optional) — only needed to run the templates that spin up a local devnet or L1 (`icm-messenger`, `l1-launch`, `token-bridge`). See the [Avalanche CLI docs](https://docs.avax.network/tooling/cli-guides/install-avalanche-cli).

## Getting started

```bash
git clone https://github.com/mericcintosun/AvaKit.git
cd AvaKit
pnpm install
```

Common commands (all run through Turborepo from the repo root):

```bash
pnpm build       # build all packages
pnpm test        # run package tests (Vitest)
pnpm typecheck   # TypeScript, no emit
pnpm lint        # Biome check (lint + format)
pnpm format      # Biome auto-format
pnpm lint:fix    # Biome check with --write (fix lint + format)
```

Work on a single package with a filter, e.g.:

```bash
pnpm --filter @avakit/core build
pnpm --filter @avakit/react test
pnpm --filter @avakit/web dev      # run the avakit.dev site locally
```

Before opening a PR, make sure `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` all pass — that is exactly what CI runs (`.github/workflows/ci.yml`).

## Repository layout

```
packages/
  core/                 @avakit/core — framework-agnostic kernel (viem only, no React)
  react/                @avakit/react — <ConnectAvalanche> + hooks (shadcn/ui)
  mcp/                  @avakit/mcp — MCP server for Claude Code / Cursor
  studio/               @avakit/studio — local dev dashboard + MCP
  create-avalanche-app/ scaffolder CLI + templates/  (the 8 shipped templates)
apps/
  web/                  @avakit/web — the avakit.dev site (private, not published)
examples/               live demo dapps (private)
docs/                   planning, PRD, architecture, ADRs, specs, security review
scripts/                repo scripts (e.g. template smoke test)
```

Templates live in `packages/create-avalanche-app/templates/`. Keep the dependency direction one-way: **core ← react ← cli ← mcp**. No circular dependencies, and never import React into `@avakit/core`.

## Template smoke test

A template smoke test scaffolds one template into a throwaway directory and verifies it installs, type-checks, and production-builds — the same flow a user gets from `npm create avalanche-app`. Build `@avakit/core`, `@avakit/react` and the scaffolder first (the script needs all three), then run it with a template id:

```bash
pnpm --filter "@avakit/core" --filter "@avakit/react" --filter create-avalanche-app build
scripts/smoke-template.sh nft-mint
```

Valid ids: `minimal`, `nft-mint`, `token-gated-app`, `erc20-token`, `icm-messenger`, `eerc-token`, `l1-launch`, `token-bridge`. CI runs all eight as a matrix in `.github/workflows/ci.yml`.

The script resolves `@avakit/*` in one of two ways:

- **Default — this checkout.** It packs your local `@avakit/core` and `@avakit/react` and pins the scaffolded app to those tarballs, so unpublished changes **are** exercised: a template that needs a new core feature is verified before that feature is released.
- **`SMOKE_USE_NPM=1` — the npm registry.** It installs the published versions the scaffolder pins instead. Run it after a release to check that those pins really resolve.

Templates that need `avalanche-cli` at runtime (`icm-messenger`, `l1-launch`, `token-bridge`) are only scaffold + typecheck + build tested; their devnet/L1 scripts are not run.

Without a second argument the app is built in a temporary directory that is removed when the script exits. To keep the app and look at it, pass a directory (`scripts/smoke-template.sh nft-mint /tmp/smoke`) or set `SMOKE_KEEP=1`.

The script switches the scaffolder's telemetry off, so a smoke run is never counted as usage. When you run the built CLI by hand from this repo (`node packages/create-avalanche-app/dist/index.js …`), set `AVAKIT_TELEMETRY_DISABLED=1` yourself: a contributor trying out a change is not adoption, and without it the run is counted on [avakit.dev/stats](https://avakit.dev/stats).

## Contracts and bytecode artifacts

The Solidity the repo ships lives in the templates (`packages/create-avalanche-app/templates/*/contracts/src`; `examples/web3auth-demo` has a contract of its own). Several files carry bytecode compiled from it, so that an app can deploy without Foundry: each template's `lib/*-artifact.ts`, and the artifacts Studio, the website and the example app use. Those artifacts are **generated — never copy an abi or bytecode into one by hand.** After you edit a contract (in every template that ships a copy of it), regenerate and verify them from `contracts-ci`:

```bash
cd contracts-ci && node scripts/sync.mjs && forge test && node scripts/check-artifacts.mjs --write
```

`sync.mjs` checks that templates sharing a contract ship identical copies and that every `foundry.toml` compiles with the same settings, `forge test` runs the contract tests, and `check-artifacts.mjs --write` rewrites the abi and bytecode of every artifact from a fresh build. Commit the regenerated artifacts together with the source change: CI runs the same three steps without `--write` and fails on any artifact that no longer matches its source.

Use the Foundry release CI pins (`version:` in `.github/workflows/ci.yml`; `foundryup --install <that version>`), because the check compares bytecode byte for byte. More in [`contracts-ci/README.md`](contracts-ci/README.md).

## Changesets (versioning)

This repo uses [Changesets](https://github.com/changesets/changesets). If your change affects a **published** package (`@avakit/core`, `@avakit/react`, `@avakit/mcp`, `@avakit/studio`, `create-avalanche-app`), add a changeset:

```bash
pnpm changeset       # describe the change + pick patch / minor / major
```

Commit the generated file in `.changeset/` with your PR. The release flow is automated:

1. You open a PR that includes a changeset.
2. After it merges to `main`, the Release workflow opens (or updates) a **"Version Packages"** PR that applies the version bumps and updates changelogs.
3. Merging that PR publishes the affected packages to npm.

Docs-only or internal-only changes (nothing user-facing) don't need a changeset. See [`RELEASING.md`](./RELEASING.md) for the full release process.

## Conventions (binding)

Read [`docs/11-conventions.md`](docs/11-conventions.md) before contributing. In short:

- **English** for everything in the repo — code, comments, identifiers, commits, PR descriptions, docs.
- **shadcn/ui only** for UI. No other component library (and not BuilderKit's UI). Avalanche-specific components are built on shadcn primitives.
- **Framer Motion / GSAP only** for animation.
- **Dark/light wired from day one** (`next-themes`); both themes must work. The website (`apps/web`) uses the "Ember Crimson" accent, defined only in `globals.css` design tokens. Keep the scaffolder templates neutral/grayscale — users brand their own apps.
- **Latest stable** versions of all frontend tech.
- Formatting and linting are handled by **Biome** (`pnpm lint`, `pnpm format`); CI runs `biome check`.
- **Testnet-first**: default to Fuji. Never deploy to mainnet without an explicit opt-in and balance check.
- Never commit secrets or private keys — key management belongs to the wallet provider, never to AvaKit code.

Please also follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Opening a good pull request

- **Branch** off `main` and keep the PR focused on one change.
- Use a clear, one-sentence, plain-English title describing what the change does.
- Fill out the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md): summary, type of change, and the checklist.
- Make sure `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass locally.
- Add a changeset if the change is user-facing (see above).
- Update docs (`README.md`, `docs/`, or template `CLAUDE.md`/`llms.txt`) when behavior changes.
- Link any related issue and describe how you verified the change.

## Reporting bugs & requesting features

Open an issue using the [bug report](./.github/ISSUE_TEMPLATE/bug_report.md) or [feature request](./.github/ISSUE_TEMPLATE/feature_request.md) template. For security issues, follow [`SECURITY.md`](./SECURITY.md) instead of filing a public issue.

## Roadmap

See [`docs/05-roadmap.md`](docs/05-roadmap.md). We build in vertical slices: M1 core + widget → M2 scaffolder → M3 MCP.
