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
Trusted Publisher on npmjs.com names this repository, `release.yml` and that
environment. The exchange is also what produces the **provenance attestation** on each
tarball (`npm publish --provenance`), so npm can prove the tarball was built from this
repo, by this workflow, at this commit.

## How release.yml is split

`release.yml` runs on every push to `main`. Its jobs hold only what they need, and the
one that can mint the npm credential runs no code of this repository and none of its
dependencies:

| Job | Runs when | Permissions | What it does |
| --- | --- | --- | --- |
| `verify` | always | `contents: read` | The gates below, then whether changesets are pending. With none pending it builds and packs every publishable package (`scripts/release-packages.mjs pack`), records each tarball's sha256 and whether npm has that version, and uploads the tarballs. |
| `version` | changesets are pending | `contents: write`, `pull-requests: write` | changesets/action opens or updates the version PR. It installs with `--ignore-scripts` and publishes nothing. |
| `version-ci` | the version PR was opened or updated | `actions: write`, `contents: read` | Starts `ci.yml` on `changeset-release/main`, so the PR has its checks (see below). |
| `publish` | nothing is pending and npm lacks a version | `id-token: write`, `contents: read`, environment `npm-publish` | Waits for approval, then checks the tarballs (sha256 against what `verify` recorded, name and version inside each, one of the five packages, no `workspace:` or `catalog:` range left) and publishes what npm still lacks, one at a time, dependencies first, with `npm publish <tarball> --provenance`. No checkout, no install. |
| `tag` | after `publish` | `contents: write` | The git tag and GitHub release of each package that reached npm, as changesets/action made them (`scripts/release-tags.mjs`). |
| `publish-dry-run` | Run workflow with **dry run** | `contents: read`, no environment, no id-token | The same download and checks as `publish`, then `npm publish --dry-run`. |

What the split does not change: the tarballs are built in `verify`, next to the
dependencies and the tests, so a dependency compromised there can still change what
they contain. It can no longer publish by itself: a person approves each publish, the
publish job publishes exactly the bytes `verify` summed, and the provenance attestation
names the workflow and the commit. No dependency cache is used anywhere in the
workflow, so nothing another job saved can end up in a tarball.

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
   bumps the listing in the same PR instead of leaving it a release behind. The
   `version-ci` job then starts `ci.yml` on the PR's branch, and its checks appear on
   the PR within a minute (see [The version PR's checks](#the-version-prs-checks)).

3. **Check the PR and its checks, then merge it.** Merging it is the publish trigger:
   the workflow runs again, `verify` passes the checks below on the merge commit, finds
   no changesets, packs the packages and sees which versions npm lacks. Its job
   summary lists every tarball with its sha256. To rehearse the publish before you
   merge, run the [dry run](#rehearse-a-publish-the-dry-run) on
   `changeset-release/main`.

4. **Approve the publish.** The `publish` job waits for the `npm-publish` environment.
   GitHub notifies the environment's reviewers; open the run (**Actions** →
   **Release** → the run of the merge commit), click **Review deployments**, tick
   **npm-publish** and click **Approve and deploy**. **Reject** stops it, and nothing is
   published. The job publishes what npm still lacks, and the `tag` job creates the
   git tags and GitHub releases. A run waits at most 30 days for its approval, and
   later pushes to `main` queue behind it, so approve or reject it promptly.

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
  standalone npm projects outside the pnpm workspace. No workflow deploys them: each is
  deployed by hand with `npx wrangler deploy` from its own directory, following its
  `README.md`. Code merged to `main` under `services/` is therefore not running until
  someone deploys it. The faucet and telemetry changes of the November review rounds
  were deployed on 2026-11-19.
- **The website.** `apps/web` is private and is not published to npm.

## Nothing is published from a red tree

Before anything is versioned, packed or published, the `verify` job runs `pnpm lint`,
`pnpm typecheck`, `pnpm test`, the changeset check (`node scripts/check-changesets.mjs`)
and the MCP install smoke test (`scripts/smoke-mcp.sh`, which packs the server,
installs it with an empty npm cache and drives the installed binary) on the commit it
is about to release, and stops if any of them fails. Every other job needs `verify`.
`scripts/workflows.test.mjs` fails when one of these steps goes missing from
`release.yml` or becomes optional, when a job's permissions grow, when the publish job
gains a checkout, an install or a script of this repository, or when its shell steps
stop doing what they say (it runs them against fixture tarballs). Releases rely on the
gate because `ci.yml` runs on the same push as a separate workflow that `release.yml`
does not wait for.

If the gate fails, nothing was versioned or published. Fix `main`; the next push runs
the release workflow again.

## The version PR's checks

The **"chore: version packages"** PR is opened with `GITHUB_TOKEN`. Since mid-2026
(GitHub changelog: *"Bot-created pull requests can run workflows if approved"*) GitHub
creates the `pull_request` runs of such a PR in an approval-required state: they have
no jobs until someone with write access clicks **Approve workflows to run**, and a PR
merged before that leaves them failed with no jobs, which the Actions tab labels
*"This run likely failed because of a workflow file issue"*. That is what runs
44558954539 (#29) and 44565792970 (#31) are: nothing was wrong with `ci.yml`. (Before
the change such PRs started no run at all: the version PRs #2, #3, #4, #5 and #10 have
none.)

So the `version-ci` job runs `gh workflow run ci.yml --ref changeset-release/main` with
`GITHUB_TOKEN`: a `workflow_dispatch` event always starts a run, even from that token.
The dispatched run checks out the head of `changeset-release/main`, which is the PR's
head commit, and GitHub matches a required status check by its name on that commit,
not by the event that produced it, so its checks (`CI passed` among them) are the PR's
checks. The PR's own pending `pull_request` runs can be left alone; approving them only
runs the same checks again.

Optional, if you would rather have the PR's own `pull_request` runs start by
themselves: open it with a GitHub App installation token instead of `GITHUB_TOKEN`.
Create a GitHub App with **Contents** and **Pull requests** read and write, install it
on this repository only, store its app ID and private key as secrets of an environment
that only the `version` job uses, mint a token in that job with
`actions/create-github-app-token` and pass it to changesets/action as `GITHUB_TOKEN`;
`version-ci` is then unnecessary. That puts a long-lived private key into the
repository's secrets, which is why it is not the default.

## Rehearse a publish: the dry run

**Actions** → **Release** → **Run workflow**, with **dry run** ticked (the default),
runs `verify` and then `publish-dry-run`: the same download and checks as the publish
job, then `npm publish --dry-run` on every tarball npm lacks. It has no environment and
no id-token, so it cannot publish, and it queues apart from real releases.

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
changesets, `verify` packs the packages, its summary says *"Nothing to publish: npm
already has every version above"*, and the `publish` and `tag` jobs are skipped. If it's
red:

- A gate in `verify` (`Lint`, `Typecheck`, `Test`, the changeset check, the MCP smoke
  test) failed → nothing was versioned or published. Fix `main`.
- `Changesets is in pre mode` → the workflow neither versions nor publishes
  prereleases; run `pnpm changeset pre exit`.
- `Pack every publishable package` failed → a packed `package.json` kept a
  `workspace:` or `catalog:` range, or names another package or version than the source.
- `Check the tarballs` failed in `publish` → nothing was published. The artifact is not
  what `verify` summed, holds a package this workflow does not publish, or the registry
  did not answer. Re-run the workflow; do not edit the artifact.
- `Publish` failed → it stops at the first package npm refused, so nothing that depends
  on it was published after it. The job summary lists what did reach npm, and the
  `tag` job still tags that. **Re-run failed jobs** after fixing the cause: what npm
  already has is skipped.
- `tag` failed → npm has the packages but a tag or release is missing. **Re-run failed
  jobs**: existing tags and releases are kept, the missing ones are created. A tag that
  already exists on another commit fails the job and is never moved.
- `version-ci` failed with *"Workflow does not have 'workflow_dispatch' trigger"* →
  `ci.yml` lost its `workflow_dispatch:` trigger, and the version PR has no checks.

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
