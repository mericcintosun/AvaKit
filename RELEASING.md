# Releasing AvaKit to npm

Published packages: `@avakit/core`, `@avakit/react`, `@avakit/mcp`, `create-avalanche-app`.
(`@avakit/web` and the examples are private and never published.)

All four names are currently **available** on npm and versioned at **0.1.0**.

## One-time prerequisites (account side — do these yourself)

1. **npm account** — create/log in at https://www.npmjs.com.
2. **Create the `avakit` org** (free) so you can publish the `@avakit/*` scope:
   https://www.npmjs.com/org/create — org name `avakit`.
   (`create-avalanche-app` is unscoped and needs no org.)
3. **Log in from the CLI:**
   ```bash
   npm login
   ```
   Enable 2FA and, if you use it, an automation/publish token for CI.
4. **Set the real repository URL.** The `repository`, `homepage`, and `bugs`
   fields in each `package.json` currently point at the placeholder
   `github.com/avakit/avakit`. Update them to your actual repo before publishing.
   (These are metadata only — nothing here runs git.)

## Publish (first release, 0.1.0)

Versions are already set to 0.1.0, so you can publish directly:

```bash
pnpm install
pnpm build                              # build all packages first
pnpm -r publish --access public --no-git-checks
```

`pnpm` automatically rewrites `workspace:*` dependencies to the real versions
(e.g. `@avakit/react` → `@avakit/core@0.1.0`) in the published tarballs.

Verify beforehand without publishing:

```bash
pnpm -r publish --dry-run --no-git-checks
```

## Ongoing releases (Changesets)

This repo is set up with [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset            # describe your change + choose bump (patch/minor/major)
pnpm version-packages     # apply version bumps + update changelogs
pnpm release              # build, then changeset publish
```

## What ships in each package

- `@avakit/core` — `dist/` (ESM + types), `README.md`, `LICENSE`. `@web3auth/modal` is an **optional** peer dependency.
- `@avakit/react` — `dist/`, `README.md`, `LICENSE`. Peer deps: `react`, `react-dom`.
- `@avakit/mcp` — `dist/`, `README.md`, `LICENSE`. Bin: `avakit-mcp`.
- `create-avalanche-app` — `dist/` + `templates/`, `README.md`, `LICENSE`. Bin: `create-avalanche-app`.

## Notes

- Node `>=20.11` is declared via `engines`.
- npm **provenance** (`--provenance`) requires publishing from CI with OIDC; skip it for local publishes.
- After the first publish, test the real flow: `npm create avalanche-app@latest my-app` in a clean directory.
