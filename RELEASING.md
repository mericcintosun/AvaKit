# Releasing AvaKit to npm

Published packages: `@avakit/core`, `@avakit/react`, `@avakit/mcp`, `@avakit/studio`,
`create-avalanche-app`. (`@avakit/web`, `services/*`, and the examples are private and
never published.)

For the live versions, run `npm view <pkg> version` — this file deliberately doesn't
list them, because a hardcoded list here is always wrong within a week.

## You cannot publish from your laptop, by design

All five packages use npm **Trusted Publishing (OIDC)** with **"disallow tokens"**
enabled, and the `NPM_TOKEN` secret has been deleted. There is no token to publish
with, and `npm publish` from a terminal will be refused by the registry. **Do not add
a token back.**

The only path is the `publish` job of `.github/workflows/release.yml`. It runs in the
**`npm-publish` environment**, so it waits until a reviewer approves it, and then
exchanges a GitHub OIDC id-token for a short-lived publish credential. Each package's
Trusted Publisher on npmjs.com must name this repository, `release.yml` and that
environment: [One-time setup](#one-time-setup-the-environment-and-the-trusted-publishers)
says how, and what is open until it does. The exchange is also what produces the
**provenance attestation** on each tarball (`npm publish --provenance`), so npm can
prove the tarball was built from this repo, by this workflow, at this commit.

## How release.yml is split

`release.yml` runs on every push to `main`. Its jobs hold only what they need, and the
one that can mint the npm credential runs no code of this repository and none of its
dependencies:

| Job | Runs when | Permissions | What it does |
| --- | --- | --- | --- |
| `verify` | always | `contents: read` | The gates below, then whether changesets are pending. |
| `version` | changesets are pending | `contents: write`, `pull-requests: write` | changesets/action opens or updates the version PR. It installs with `--ignore-scripts` and publishes nothing. GitHub holds the PR's CI runs until a maintainer approves them (see [The version PR's checks](#the-version-prs-checks)). |
| `pack` | nothing is pending (on `main`), or a dry run | `contents: read` | On a runner of its own, from a fresh checkout: installs with `--ignore-scripts`, builds the packages, packs every publishable one (`scripts/release-packages.mjs pack`), records each tarball's sha256 and whether npm has that version, and uploads the tarballs. Nothing else runs there. |
| `publish` | nothing is pending and npm lacks a version | `id-token: write`, `contents: read`, environment `npm-publish` | Waits for approval, then checks the tarballs (sha256 against what `pack` recorded, name and version inside each, one of the five packages, no `workspace:` or `catalog:` range left) and publishes what npm still lacks, one at a time, dependencies first, with `npm publish <tarball> --provenance`. No checkout, no install. |
| `tag` | after `publish` | `contents: write` | The git tag and GitHub release of each package that reached npm, as changesets/action made them (`scripts/release-tags.mjs`). |
| `publish-dry-run` | Run workflow with **dry run** | `contents: read`, no environment, no id-token | The same download and checks as `publish`, then `npm publish --dry-run`. |

What can still change a tarball is the build. The tests and the MCP smoke test (which
installs the packed server with npm, install scripts and all) run in `verify`, on
another runner, and never touch the tarballs; `pack` starts from a fresh checkout,
installs without running any install script, and runs only the packages' builds and
`pnpm pack`. A compromised build tool (tsup, vite, esbuild, Turborepo and what they
load) can still change what it builds, but it cannot publish by itself: a person
approves each publish, the publish job publishes exactly the bytes `pack` summed, and
the provenance attestation names the workflow and the commit. No job restores or saves
an Actions cache (`cache-mode: none`, which GitHub enforces), so nothing another run
saved can end up in a tarball.

## One-time setup: the environment and the Trusted Publishers

Two settings outside this repository's files hold the publish path together. Set them
once, and check them again after a fork, a transfer or a change of maintainers.

1. **The `npm-publish` environment** (GitHub: **Settings** → **Environments** → **New
   environment**, name `npm-publish`):
   - **Required reviewers**: the maintainers who may release. While there is one
     maintainer, leave **Prevent self-review** off, or nobody can approve the release
     that their own merge started.
   - **Deployment branches and tags**: **Selected branches and tags**, with the one
     rule `main`.
   - Untick **Allow administrators to bypass configured protection rules**.

   Create it before the publish job first runs: a job that names an environment that
   does not exist creates it, with no protection at all.
2. **Each package's Trusted Publisher** (npmjs.com: the package → **Settings** →
   **Trusted Publisher**), for `@avakit/core`, `@avakit/react`, `@avakit/mcp`,
   `@avakit/studio` and `create-avalanche-app`: **GitHub Actions**, organization or user
   `mericcintosun`, repository `AvaKit`, workflow filename `release.yml`, environment
   name `npm-publish`. Keep **Publishing access** on *Require two-factor
   authentication and disallow tokens*.

   Until the environment name is set there, npm accepts an id-token from any run of
   `release.yml`, on any branch, in any job given `id-token: write`, and the approval
   is GitHub's alone. Once it is set, npm itself refuses every job except one that a
   reviewer let into `npm-publish`, which deploys from `main` only.

## The release flow

1. **Describe the change** on your branch:
   ```bash
   pnpm changeset      # pick the packages + bump, write the changelog line
   ```
   Commit the generated `.changeset/*.md` and merge to `main`.

   A changeset that releases `@avakit/core` needs one for `@avakit/mcp` as well. The
   server carries core inside its bundle (its only runtime dependency is
   `create-avalanche-app`), so Changesets no longer bumps it when core changes, and a
   core fix would otherwise never reach agent users. `node scripts/check-changesets.mjs`
   fails CI and the release job when the server's changeset is missing.

2. **The bot opens a PR.** The workflow sees a pending changeset and opens/updates a
   **"chore: version packages"** PR (branch `changeset-release/main`) that applies the
   bumps and rewrites the changelogs. Nothing is published yet. The PR is produced by
   `pnpm version-packages`: `changeset version`, followed by `@avakit/mcp`'s
   `sync:server-json` script when the package defines one. Changesets does not know
   `packages/mcp/server.json` (the MCP Registry listing), so that script is what
   bumps the listing in the same PR instead of leaving it a release behind. The PR's
   CI does not start by itself; that is the next step.

3. **Start the PR's CI, check the PR, then merge it.** Open the PR and click **Approve
   workflows to run** in its merge box: GitHub holds the CI runs of a PR that
   `GITHUB_TOKEN` opened or updated until someone with write access starts them (see
   [The version PR's checks](#the-version-prs-checks)). Every update of the PR needs
   that click again, and every push to `main` while changesets are pending updates it.
   Wait for **CI passed**, read the versions in the diff, and merge. Merging it is the
   publish trigger: the workflow runs again, `verify` passes the checks below on the
   merge commit and finds no changesets, and `pack` packs the packages and sees which
   versions npm lacks. Its job summary lists every tarball with its sha256. To rehearse
   the publish before you merge, run the [dry run](#rehearse-a-publish-the-dry-run) on
   `changeset-release/main`.

4. **Approve the publish.** The `publish` job waits for the `npm-publish` environment.
   GitHub notifies the environment's reviewers; open the run (**Actions** →
   **Release** → the run of the merge commit), click **Review deployments**, tick
   **npm-publish** and click **Approve and deploy**. The job publishes what npm still
   lacks, and the `tag` job creates the git tags and GitHub releases. A run waits at
   most 30 days for its approval, and later pushes to `main` queue behind it, so
   approve or reject it promptly.

   **Reject** stops that run and publishes nothing, but it does not call the release
   off: every later push to `main` runs `verify` and `pack` again, finds the same
   versions missing from npm, and asks for the approval again, until npm has them. To
   call a release off, revert the version PR's merge commit. That puts the versions
   back and restores the changesets the PR consumed, so the `version` job opens a new
   version PR; delete those changesets as well if the change should not be released at
   all.

5. **Verify.** `npm view <pkg> version`, and smoke-test the real thing in a clean dir:
   ```bash
   AVAKIT_TELEMETRY_DISABLED=1 npm create avalanche-app@latest my-app -- --template nft-mint --yes
   cd my-app && npm run build
   ```
   The CLI installs the dependencies itself, with the package manager that launched it
   (npm here). Keep `AVAKIT_TELEMETRY_DISABLED=1` on that command. A maintainer checking
   a release is not someone using AvaKit, and without it the run is counted as a
   scaffold on avakit.dev/stats. Two scripted variants, both with telemetry already off:
   - `SMOKE_USE_NPM=1 scripts/smoke-template.sh <template>` scaffolds with the locally
     built CLI, installs the published `@avakit/*` versions that CLI pins, then
     type-checks and builds.
   - `node scripts/e2e-fuji.mjs --source npm --skip-chain` starts the published
     `@avakit/mcp` with npx, has it scaffold `nft-mint`, and installs and builds the app
     with npm. Without `--skip-chain` it also deploys and mints on Fuji, which takes one
     drip from the shared faucet. The **E2E · Fuji · published packages** workflow
     (`.github/workflows/e2e-fuji.yml`) runs the same script daily and on demand
     (**Run workflow**, with the version to test) on fresh Linux, macOS and Windows
     runners; see [`CONTRIBUTING.md`](./CONTRIBUTING.md#end-to-end-run-on-fuji).
   - `npm_config_cache="$(mktemp -d)" npx -y @avakit/mcp --version` downloads the
     published server into an empty cache, the way a client's first start does, and
     should print the new version within a few seconds.

6. **Republish the MCP Registry listing by hand.** See the next section.

## What an npm release does not do

- **The MCP Registry listing.** The version PR already carries the new version in
  `packages/mcp/server.json`, but changing that file does not change the live listing
  (`dev.avakit/avalanche`). After `@avakit/mcp` is on npm, publish the listing with
  `mcp-publisher` from your own machine; the steps, and where the signing key lives, are
  in [`packages/mcp/REGISTRIES.md`](packages/mcp/REGISTRIES.md). It stays manual so that
  the release pipeline holds no token.
- **The two Cloudflare Workers.** `services/faucet` and `services/telemetry` are
  standalone npm projects outside the pnpm workspace, and `release.yml` never deploys
  them. Their own workflow, `.github/workflows/deploy-workers.yml`, does that
  separately, behind its own approval; [`services/DEPLOY.md`](services/DEPLOY.md)
  describes it. Code merged to `main` under `services/` is not running until that
  deploy has been approved and has finished.
- **The website.** `apps/web` is private and is not published to npm.

## Nothing is published from a red tree

Before anything is versioned, packed or published, the `verify` job runs `pnpm lint`,
`pnpm typecheck`, `pnpm test`, the changeset check (`node scripts/check-changesets.mjs`)
and the MCP install smoke test (`scripts/smoke-mcp.sh`, which packs the server,
installs it with an empty npm cache and drives the installed binary) on the commit it
is about to release, and stops if any of them fails. Every other job needs `verify`,
directly or through `pack` or `publish`. `scripts/workflows.test.mjs` fails when one of
these steps goes missing from `release.yml` or becomes optional, when a job's
permissions grow or one may start another workflow, when `pack` runs anything but the
install, the build and the pack, when another job uploads the tarballs, when the
publish job gains a checkout, an install or a script of this repository, or when its
shell steps stop doing what they say (it runs them against fixture tarballs). Releases
rely on the gate because `ci.yml` runs on the same push as a separate workflow that
`release.yml` does not wait for.

If the gate fails, nothing was versioned or published. Fix `main`; the next push runs
the release workflow again.

## The version PR's checks

The **"chore: version packages"** PR is opened and updated by changesets/action with
`GITHUB_TOKEN`. Since mid-2026 (GitHub changelog: *"Bot-created pull requests can run
workflows if approved"*; GitHub docs:
[Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow))
GitHub creates the `pull_request` runs of a PR that `GITHUB_TOKEN` opened or updated in
an approval-required state: they have no jobs until someone with write access clicks
**Approve workflows to run** in the PR's merge box, and a PR merged before that leaves
them failed with no jobs, which the Actions tab labels *"This run likely failed because
of a workflow file issue"*. That is what runs 44558954539 (#29) and 44565792970 (#31)
are: nothing was wrong with `ci.yml`.

So a maintainer starts them, as step 3 of [the release flow](#the-release-flow) says:
**Approve workflows to run** on the PR, once per update of the PR, because every push
changesets/action makes to `changeset-release/main` creates new runs that wait again.
The approved runs are the PR's own `pull_request` runs, so their **CI passed** is the
check the `main` branch ruleset requires, and the PR can be merged once it is green.

Starting `ci.yml` on the PR's branch some other way does not replace that click. A
`workflow_dispatch` run, which `GITHUB_TOKEN` is allowed to start (for example with
`gh workflow run ci.yml --ref changeset-release/main`), tests the same commit, but
GitHub counts the checks of a workflow job for a pull request only when an event such
as `push` or `pull_request` started the run: a dispatched run's checks do not show on
the PR and do not satisfy a required check (GitHub docs:
[Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)).

The one hands-off option is to open the PR with a GitHub App installation token
instead of `GITHUB_TOKEN`, which lets its `pull_request` runs start without the click.
Create a GitHub App with **Contents** and **Pull requests** read and write and no
webhook, install it on this repository only, store its app ID and private key as
secrets of an environment that only the `version` job uses, mint a token in that job
with `actions/create-github-app-token` and pass it to changesets/action as
`GITHUB_TOKEN`. That puts a long-lived private key into the repository's secrets, which
is why it is the owner's choice and not the default.

## Rehearse a publish: the dry run

**Actions** → **Release** → **Run workflow**, with **dry run** ticked (the default),
runs `verify`, `pack` and then `publish-dry-run`: the same download and checks as the
publish job, then `npm publish --dry-run` on every tarball npm lacks. It has no
environment and no id-token, so it cannot publish, and it queues apart from real
releases.

npm refuses a version it already has, even in a dry run, so on `main` (where every
version is already published) the dry run checks the tarballs and ends with a notice
that there is nothing to run `npm publish --dry-run` on. Pick **changeset-release/main**
as the branch to rehearse the open version PR: there the bumped versions are not on npm
yet, and each is dry-run published exactly as the publish job would publish it.

With **dry run** unticked on `main`, Run workflow is a release like a push: it versions
or publishes, and the publish still waits for approval. On any other branch it only
runs `verify`.

## Before merging the version PR — check this

**Changesets on a 0.x package does not do what you expect.** A `minor` changeset on
`0.1.x` produces **`0.2.0`**, not `0.1.7`. Read the version in the PR diff rather than
predicting it.

> **The scaffolder's `@avakit/*` pins now take care of themselves.** The `^` version
> stamped into every scaffolded app for `@avakit/core` and `@avakit/react` is **derived
> per package at build time** (tsup reads each one's `package.json`; see the `define` in
> `packages/create-avalanche-app/tsup.config.ts` and `AVAKIT_CORE_VERSION` /
> `AVAKIT_REACT_VERSION` in `api.ts`). This used to be a hand-maintained constant
> (`AVAKIT_DEP_VERSION`) that had to stay at or below the lowest published version, or
> every scaffold failed at `pnpm install` — the sharpest edge in the repo. It is gone:
> core and react can diverge freely and each app pins exactly what shipped. Nothing to
> remember here anymore. (Guarded by `src/api.test.ts`.)

Templates ship a `pnpm-workspace.yaml` with `minimumReleaseAgeExclude: ['@avakit/*']`
so a freshly published `@avakit/*` isn't blocked by pnpm's supply-chain age gate for
its first ~2 days.

## The npm version is pinned, and must stay pinned

The publish job runs `npm install -g npm@11` — **never `npm@latest`.** OIDC trusted
publishing needs npm `>= 11.5.1`, which the runner's bundled npm may not be.

npm 12 changed `npm info <pkg> --json` to return an array where 11 returned the
packument object. Changesets, which published from this workflow until the jobs were
split, read `pkgInfo.versions` off that result, got `undefined` on an array, concluded
**every** package was unpublished, tried to republish all five, and npm refused with
*"You cannot publish over the previously published versions"* — turning the release red
while the genuinely-new packages actually published fine. Nothing in the workflow reads
`npm info` any more (it asks the registry directly which versions exist), but a new npm
major is the publishing tool changing under a release: move to it on purpose, after a
dry run, not whenever it ships. npm 11.21 satisfies OIDC's `>= 11.5.1` requirement.

## Reading a red release

The workflow publishing *nothing* is the normal steady state: on a push with no pending
changesets, `pack` packs the packages, its summary says *"Nothing to publish: npm
already has every version above"*, and the `publish` and `tag` jobs are skipped. If it's
red:

- A gate in `verify` (`Lint`, `Typecheck`, `Test`, the changeset check, the MCP smoke
  test) failed → nothing was versioned or published. Fix `main`.
- `Changesets is in pre mode` → the workflow neither versions nor publishes
  prereleases; run `pnpm changeset pre exit`.
- `Install (no install scripts)` or `Build the packages` failed in `pack` while
  `verify` passed → the packages do not build from a fresh checkout without install
  scripts. Find what needs one; do not let `pack` run install scripts.
- `Pack every publishable package` failed in `pack` → a packed `package.json` kept a
  `workspace:` or `catalog:` range, or names another package or version than the source.
- `Check the tarballs` failed in `publish` → nothing was published. The artifact is not
  what `pack` summed, holds a package this workflow does not publish, or the registry
  did not answer. Re-run the workflow; do not edit the artifact.
- `Publish` failed → it stops at the first package npm refused, so nothing that depends
  on it was published after it. The job summary lists what did reach npm, and the
  `tag` job still tags that. **Re-run failed jobs** after fixing the cause: what npm
  already has is skipped.
- `tag` failed → npm has the packages but a tag or release is missing. **Re-run failed
  jobs**: existing tags and releases are kept, the missing ones are created. A tag that
  already exists on another commit fails the job and is never moved.
- The `publish` job was rejected → nothing was published, and the same versions come
  back for approval on the next push to `main`; step 4 of
  [the release flow](#the-release-flow) says how to call a release off.

## What ships in each package

- `@avakit/core` — `dist/` (ESM + types), `README.md`, `LICENSE`. `@web3auth/modal` and
  the Coinbase SDK are **optional** peer dependencies.
- `@avakit/react` — `dist/`, `README.md`, `LICENSE`. Peer deps: `react`, `react-dom`.
- `@avakit/mcp` — `dist/`, `README.md`, `LICENSE`. Bin: `avakit-mcp`.
- `@avakit/studio` — `dist/` only (the UI is bundled into it; npm adds `README.md` +
  `LICENSE` regardless of `files[]`). Bin: `avakit-studio`.
- `create-avalanche-app` — `dist/` + `templates/`, `README.md`, `LICENSE`. Bin:
  `create-avalanche-app`. `files` in its `package.json` also excludes what tools leave
  behind inside a template directory (`node_modules`, `.next`, `.turbo`, Foundry's
  `contracts/out`, `cache` and `broadcast`, and `.env` files), so a publish from a
  checkout that has built or run a template does not ship them. `src/pack.test.ts`
  checks the packed file list.

`pnpm pack` rewrites `workspace:*` dependencies to the real published versions in the
tarballs (and `catalog:` ranges to the catalog's versions), so `@avakit/react`'s
dependency on `@avakit/core` resolves for consumers. `scripts/release-packages.mjs pack`
fails when a packed `package.json` still holds such a range, and the publish job checks
it again before it publishes.

## Notes

- `create-avalanche-app` declares Node `>=22` via `engines` (its wizard library, `ink`,
  requires 22). The scaffolder reads that floor from its own `package.json` and refuses
  to run below it with one line. The other packages declare `>=20.11`. The published
  flow is run on Node 22, 24 and 26 (`e2e-fuji.yml`).
- `files[]` in `package.json` **overrides `.gitignore`** — if a package needs to exclude
  something from its tarball, add a negated pattern (`"!templates/**/.next/**"`) to
  `files` itself, as `create-avalanche-app` does. Its old `.npmignore` is gone. (This
  once shipped stray Foundry build output inside a template.)
- `@avakit/core` injects its own version at build time, so `VERSION` is only correct in
  built artifacts, not when running from source.
