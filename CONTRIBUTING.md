# Contributing to AvaKit

Thanks for your interest in AvaKit — the open-source, AI-native Avalanche developer toolkit. Bug reports, docs fixes, new templates, and features are all welcome.

## Prerequisites

- **Node.js `>= 22.18`** (`engines` in the root `package.json`; `.nvmrc` names 24, and CI runs Node 22 and 24).
- **pnpm `>= 10`** — run `corepack enable` to get the version pinned in `package.json` (`pnpm@10.20.0`).
- **Foundry** (optional) — only needed if you work on contract templates or regenerate bundled bytecode (see [Contracts and bytecode artifacts](#contracts-and-bytecode-artifacts)), or run the browser tests, which need its `anvil` ([`apps/web/e2e/README.md`](apps/web/e2e/README.md)). Install with `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- **Avalanche CLI** (optional) — only needed to run the templates that spin up a local devnet or L1 (`icm-messenger`, `l1-launch`, `token-bridge`) and Studio's Devnet, Launch on Fuji and Interchain views, all of them experimental. Install it from [ava-labs/avalanche-cli](https://github.com/ava-labs/avalanche-cli). It has been in maintenance mode since December 2025, and its pages were removed from the Avalanche documentation on 2026-10-06; those templates were last proven end to end with version 1.9.6.

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

Before opening a PR, make sure `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` all pass. That is the main CI job (`.github/workflows/ci.yml`), run on Node 22 and 24. CI also runs:

- the [template smoke test](#template-smoke-test) for all eight templates;
- the [MCP install smoke test](#mcp-install-smoke-test);
- the [contract tests and the artifact check](#contracts-and-bytecode-artifacts);
- the tests of the two Workers under `services/`, which are standalone npm projects outside the pnpm workspace: `cd services/faucet && npm ci && npm test` (likewise `services/telemetry`; Node 22.15 or newer);
- the checks on the repo's own scripts: `node --test scripts/*.test.mjs`, `node scripts/check-template-deps.mjs`, `node scripts/check-template-commands.mjs` and `node scripts/check-changesets.mjs` (see [Changesets](#changesets-versioning));
- a dependency audit that fails on a high or critical advisory (`pnpm audit`, and `npm audit` in each Worker) and, on a pull request, a dependency review that fails on a new one.

The last job of `ci.yml`, **CI passed**, fails on a pull request unless every other job succeeded, and it is the check the ruleset on `main` requires before a pull request can merge. A pull request also runs the browser tests (`.github/workflows/e2e-browser.yml`, see [`apps/web/e2e/README.md`](apps/web/e2e/README.md)), CodeQL and the secret scan.

A further workflow, `.github/workflows/e2e-fuji.yml`, is not part of a pull request's checks: it runs the [end-to-end script](#end-to-end-run-on-fuji) against the packages published on npm, daily and on demand.

`pnpm typecheck` builds the website before it type-checks it. `tsc` reads `.next/types`, which `next build` deletes and rewrites, so `apps/web/turbo.json` orders the two instead of letting them race.

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
services/               faucet + telemetry Cloudflare Workers (standalone npm projects, not in the workspace)
contracts-ci/           Foundry harness: contract tests + artifact check (repo-only)
docs/                   planning, PRD, architecture, ADRs, specs, security review
scripts/                repo scripts (template and MCP smoke tests, end-to-end Fuji run, template dependency and changeset checks) and their tests
```

Templates live in `packages/create-avalanche-app/templates/`. Keep the dependency direction one-way: **core ← react ← cli ← mcp**. No circular dependencies, and never import React into `@avakit/core`.

The templates are standalone apps, not workspace members, and Dependabot does not update them. When you bump a dependency in one template, bump it in every template that uses it, in the same commit: `node scripts/check-template-deps.mjs` (run in CI) fails when two templates pin different versions of a dependency they share.

## Template smoke test

A template smoke test scaffolds one template into a throwaway directory with the locally built scaffolder and verifies that the app installs, type-checks, and production-builds. It installs with pnpm; the [end-to-end run](#end-to-end-run-on-fuji) is the one that uses npm. Build `@avakit/core`, `@avakit/react` and the scaffolder first (the script needs all three), then run it with a template id:

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

The script switches the scaffolder's telemetry off, so a smoke run is never counted as usage. When you run the built CLI by hand from this repo (`node packages/create-avalanche-app/dist/index.js …`), set `AVAKIT_TELEMETRY_DISABLED=1` yourself: a contributor trying out a change is not adoption, and without it the run is counted on [avakit.dev/stats](https://avakit.dev/stats). The variable also works in front of `pnpm test` and any other `turbo` command: `turbo.json` passes it (and `DO_NOT_TRACK`, `AVAKIT_TELEMETRY_URL` and `AVAKIT_CONFIG_DIR`) through to the tasks, which Turborepo's strict environment would otherwise drop.

## MCP install smoke test

`@avakit/mcp` is published as one bundled file: viem, zod, the MCP SDK and `@avakit/core` are inside `dist/index.js`, and `create-avalanche-app` is its only runtime dependency. An MCP client gives a server a fixed time to connect (30 seconds in Claude Code), and on an empty npm cache the unbundled server once took longer than that to download. The package's own tests run the source; this script checks the tarball:

```bash
AVAKIT_TELEMETRY_DISABLED=1 bash scripts/smoke-mcp.sh
```

It packs `create-avalanche-app` and `@avakit/mcp`, installs both with npm into an empty project with an empty npm cache, fails if viem, zod, the MCP SDK or `@avakit/core` were installed next to the server, runs the installed `avakit-mcp --version`, and drives the installed server over stdio (initialize, tools/list, list_templates, scaffold_app). It prints what a first start costs: packages installed, size on disk, install and start time. It contacts the npm registry only; the one call that would read a balance runs with `fetch` stubbed. CI runs it on every change, and the release job runs it before anything is published.

The build fails on purpose when the bundle would break at run time (a bare import or a `require` left for run time) or when a bundled package has a missing or non-permissive licence; it writes `dist/THIRD_PARTY_LICENSES.txt` from what it bundled. After a dependency update, rebuild `@avakit/mcp` and run this script.

## End-to-end run on Fuji

`scripts/e2e-fuji.mjs` goes through AvaKit the way an AI agent on a clean machine would, with nothing but Node.js and npm. It starts the MCP server and speaks MCP to it over stdio; checks that the server lists every tool the flow needs (`scaffold_app`, `deploy_contract`, `write_contract`, `read_chain`, `wallet_status`); has `scaffold_app` create the `nft-mint` template; installs and builds the app with npm; and then, on the Fuji testnet, calls `wallet_status`, `deploy_contract`, `write_contract` (mint) and `read_chain` (the owner of token 1). It reads no file of the scaffolded project itself: the artifact path comes from `scaffold_app`'s result. Fuji is the only chain, and the script removes `AVAKIT_ALLOW_MAINNET` from the server's environment.

It has two modes, and `--source` is required:

```bash
# The packages published on npm: @avakit/mcp started with npx.
node scripts/e2e-fuji.mjs --source npm [--version <v|latest>] [--skip-chain] [--keep] [--json <file>]

# This checkout's build of the MCP server.
pnpm build
node scripts/e2e-fuji.mjs --source workspace [--skip-chain] [--keep] [--json <file>]
```

- **`--source npm`** tests what users get. It is what `.github/workflows/e2e-fuji.yml` runs, daily and from **Run workflow**, on fresh GitHub-hosted runners (Ubuntu with Node 22, 24 and 26, macOS, Windows) that have Node.js and npm and nothing of AvaKit. `--version` picks the `@avakit/mcp` version or dist-tag (default `latest`). When a run of that workflow fails, its report job opens an issue labelled `e2e-failure` (or comments on the open one) with each failing leg's "Failed at" line, and the next passing run of `latest` closes it (`scripts/e2e-fuji-report.mjs`).
- **`--source workspace`** tests your changes to the MCP server before they are released. The scaffolded app is installed and built only when the `@avakit/core` and `@avakit/react` versions it pins are on npm; otherwise that half is reported as skipped, and `scripts/smoke-template.sh` is what covers it against this checkout.

**The on-chain half spends one drip of the shared Fuji faucet per run.** Without `AVAKIT_DEPLOYER_KEY` in the environment the server signs with its session test wallet and asks AvaKit's faucet to fund it. That faucet is shared and rate-limited, and it is what a newcomer's first run depends on, so:

- Pass **`--skip-chain`** whenever the change you are checking is not about deploying or minting: scaffolding, templates, the build, the install on another operating system. The run then stops after the build, sends no transaction and asks no faucet. The server must still list all five tools.
- Run the on-chain half when you changed the signing tools, the session wallet, the faucet client or the `nft-mint` contract, and run it once, not in a loop. The workflow does the same: only one of its five legs (Ubuntu, Node 24) goes on chain.
- When the faucet refuses or is empty, the run fails and its summary says that the faucet, not necessarily a package, is what failed. Nothing that signs or asks the faucet is tried a second time. Wait out the rate limit before running it again.
- With `AVAKIT_DEPLOYER_KEY` set to your own funded Fuji key the faucet is not asked; the summary then says that the session wallet was not exercised.

`--keep` leaves the temporary directory with the scaffolded app in place, and `--json <file>` also writes the summary as JSON. Every child process runs with `DO_NOT_TRACK=1` and `AVAKIT_TELEMETRY_DISABLED=1`, so a run is not counted as usage. The whole run is stopped after 20 minutes (`AVAKIT_E2E_TIMEOUT_SECONDS` changes that). Exit status: `0` when every step that ran passed, `1` when a step failed or the run timed out, `2` for a usage error.

The parts of the script that have no side effects are tested offline by `scripts/e2e-fuji.test.mjs`, which CI runs with the other script tests (`node --test scripts/*.test.mjs`).

## Contracts and bytecode artifacts

The Solidity the repo ships lives in the templates (`packages/create-avalanche-app/templates/*/contracts/src`; `examples/web3auth-demo` has a contract of its own). Nine artifacts carry bytecode compiled from it, so that an app can deploy without Foundry:

- the five templates' own `lib/*-artifact.ts` (`erc20-token`, `l1-launch`, `nft-mint`, `token-gated-app`, `icm-messenger`);
- the `DemoToken` entry of `token-bridge`'s `lib/ictt-artifacts.json`, which is the `erc20-token` contract;
- the messenger bytecode Studio deploys (`packages/studio/src/messenger-artifact.ts`);
- the website's `apps/web/lib/nft-artifact.ts` and the example's `examples/web3auth-demo/lib/nft-artifact.ts`.

Those artifacts are **generated — never copy an abi or bytecode into one by hand.** After you edit a contract (in every template that ships a copy of it), regenerate and verify them from `contracts-ci`:

```bash
cd contracts-ci && node scripts/sync.mjs && forge test && node scripts/check-artifacts.mjs --write
```

- `sync.mjs` checks that templates sharing a contract ship identical copies, and that every `foundry.toml` compiles with the settings of `contracts-ci/foundry.toml`. It reads the `[profile.default]` table only, so it refuses a `foundry.toml` that could change the compiler from anywhere else: a sub-table or array table of that profile, the header in another spelling, the legacy `[default]` table, or a key above the first table.
- `forge test` runs the contract tests.
- `check-artifacts.mjs` rebuilds each contract and compares all nine artifacts with the build, and the three upstream ones below as well; with `--write` it rewrites the ones that drifted. It also fails on a committed `*-artifact.ts` or `*-artifacts.json` it has not been told about, so a new artifact cannot land unchecked.

Commit the regenerated artifacts together with the source change: CI (the `contracts` job) runs the same three steps without `--write` and fails on any artifact that no longer matches its source.

The other three entries of `token-bridge`'s `lib/ictt-artifacts.json` (`ERC20TokenHome`, `ERC20TokenRemote`, `TeleporterRegistry`) are builds of `ava-labs/icm-contracts` `v1.0.9`, whose sources are not in this repository. `check-artifacts.mjs` builds them too, from the upstream sources pinned in `contracts-ci/upstream/icm-contracts/`, and compares them byte for byte. It fetches those sources from GitHub the first time and caches them, so the first run needs the network ([`contracts-ci/README.md`](contracts-ci/README.md), "Upstream contracts").

When you change either script, run its tests as well: `node --test scripts/guards.test.mjs` from `contracts-ci` (it needs `forge`). Each test breaks one thing in a temporary copy and expects the script to fail on it. CI runs it as well, as the last step of the `contracts` job.

Use the Foundry release CI pins (`version:` in `.github/workflows/ci.yml`; `foundryup --install <that version>`), because the check compares bytecode byte for byte. More in [`contracts-ci/README.md`](contracts-ci/README.md).

## Changesets (versioning)

This repo uses [Changesets](https://github.com/changesets/changesets). If your change affects a **published** package (`@avakit/core`, `@avakit/react`, `@avakit/mcp`, `@avakit/studio`, `create-avalanche-app`), add a changeset:

```bash
pnpm changeset       # describe the change + pick patch / minor / major
```

Commit the generated file in `.changeset/` with your PR. A change to `@avakit/core` needs a changeset for `@avakit/mcp` too: the server bundles core, so it is not bumped with it automatically, and `node scripts/check-changesets.mjs` fails CI when that changeset is missing.

The release flow is automated, with one person in the loop:

1. You open a PR that includes a changeset.
2. After it merges to `main`, the Release workflow opens (or updates) a **"chore: version packages"** PR that applies the version bumps and updates changelogs. GitHub does not start CI on a PR the workflow's own token opened or updated until someone with write access allows it.
3. A maintainer clicks **Approve workflows to run** on that PR (again after every update of it), waits for **CI passed**, checks the PR and merges it. The Release workflow runs the gates again, packs the packages, and its publish job waits for approval in the `npm-publish` environment.
4. A maintainer with review rights on that environment approves the deployment (**Review deployments** on the run). The publish job then publishes what npm does not have yet, with provenance, and the tag job creates the git tags and GitHub releases.

Docs-only or internal-only changes (nothing user-facing) don't need a changeset. See [`RELEASING.md`](./RELEASING.md) for the full release process, including the dry run that rehearses a publish.

## Conventions (binding)

Read [`docs/11-conventions.md`](docs/11-conventions.md) before contributing. In short:

- **English** for everything in the repo — code, comments, identifiers, commits, PR descriptions, docs.
- **shadcn/ui only** for UI. No other component library (and not BuilderKit's UI). Avalanche-specific components are built on shadcn primitives.
- **Framer Motion / GSAP only** for animation.
- **Dark/light wired from day one** (`next-themes`); both themes must work. The website (`apps/web`) uses the "Ember Crimson" accent, defined only in `globals.css` design tokens. Keep the scaffolder templates neutral/grayscale — users brand their own apps.
- **Latest stable** versions of all frontend tech.
- Formatting and linting are handled by **Biome** (`pnpm lint`, `pnpm format`); CI runs `biome check`.
- **Testnet-first**: default to Fuji. Never deploy to mainnet without an explicit opt-in and balance check.
- Never commit secrets or private keys — key management belongs to the wallet provider, never to AvaKit code. The two deliberate exceptions are throwaway and testnet-only (the in-browser burner wallet and the MCP server's session test wallet, see [`SECURITY.md`](./SECURITY.md)); do not add a third, and do not let either hold value.

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
