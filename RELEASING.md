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

The only path is `.github/workflows/release.yml`, which runs on every push to `main`
and exchanges a GitHub OIDC id-token for a short-lived publish credential. That
exchange is also what produces the **provenance attestation** on each tarball
(`NPM_CONFIG_PROVENANCE: true`), so npm can prove the tarball was built from this repo.

## The release flow

1. **Describe the change** on your branch:
   ```bash
   pnpm changeset      # pick the packages + bump, write the changelog line
   ```
   Commit the generated `.changeset/*.md` and merge to `main`.

2. **The bot opens a PR.** The workflow sees a pending changeset and opens/updates a
   **"chore: version packages"** PR (branch `changeset-release/main`) that applies the
   bumps and rewrites the changelogs. Nothing is published yet.

3. **Check the PR, then merge it.** Merging it is the publish trigger: the workflow
   runs again, finds no changesets, and publishes whatever is newer than npm.

4. **Verify.** `npm view <pkg> version`, and smoke-test the real thing in a clean dir:
   ```bash
   npm create avalanche-app@latest my-app
   cd my-app && pnpm install && pnpm build
   ```

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

`release.yml` runs `npm install -g npm@11` — **never `npm@latest`.**

npm 12 changed `npm info <pkg> --json` to return an array where 11 returned the
packument object. Changesets reads `pkgInfo.versions` off that result, gets `undefined`
on an array, concludes **every** package is unpublished, tries to republish all five,
and npm refuses with *"You cannot publish over the previously published versions"* —
turning the release red while the genuinely-new packages actually published fine. npm
11.18 satisfies OIDC's `>= 11.5.1` requirement. Revisit only once changesets handles
npm 12's output.

## Reading a red release

The workflow publishing *nothing* is the normal steady state — a push with no pending
changesets should log `No unpublished projects to publish` and go green. If it's red:

- `You cannot publish over the previously published versions` → the npm-12 bug above.
- `is being published because our local version has not been published on npm` for a
  package that *is* published → same bug.
- A partial failure still publishes the healthy packages. Read
  `packages published successfully:` before assuming nothing shipped.

## What ships in each package

- `@avakit/core` — `dist/` (ESM + types), `README.md`, `LICENSE`. `@web3auth/modal` and
  the Coinbase SDK are **optional** peer dependencies.
- `@avakit/react` — `dist/`, `README.md`, `LICENSE`. Peer deps: `react`, `react-dom`.
- `@avakit/mcp` — `dist/`, `README.md`, `LICENSE`. Bin: `avakit-mcp`.
- `@avakit/studio` — `dist/` only (the UI is bundled into it; npm adds `README.md` +
  `LICENSE` regardless of `files[]`). Bin: `avakit-studio`.
- `create-avalanche-app` — `dist/` + `templates/`, `README.md`, `LICENSE`. Bin:
  `create-avalanche-app`.

`pnpm` rewrites `workspace:*` dependencies to the real published versions in the
tarballs, so `@avakit/react`'s dependency on `@avakit/core` resolves for consumers.

## Notes

- Node `>=20.11` is declared via `engines`.
- `files[]` in `package.json` **overrides `.gitignore`** — if a package needs to exclude
  something from its tarball, use `.npmignore`. (This once shipped a stray tarball.)
- `@avakit/core` injects its own version at build time, so `VERSION` is only correct in
  built artifacts, not when running from source.
