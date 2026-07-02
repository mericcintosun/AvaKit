# Releasing AvaKit to npm

Published packages: `@avakit/core`, `@avakit/react`, `@avakit/mcp`, `@avakit/studio`, `create-avalanche-app`.
(`@avakit/web` and the examples are private and never published.)

Currently published: `@avakit/core@0.1.3` · `@avakit/react@0.1.3` · `create-avalanche-app@0.1.10` ·
`@avakit/mcp@0.1.10` · `@avakit/studio@0.1.6`. (Run `npm view <pkg> version` for the live value.)

## One-time prerequisites (account side)

1. **npm account + `avakit` org** — the `@avakit/*` scope publishes under the `avakit` org;
   `create-avalanche-app` is unscoped. Both are already live.
2. **Log in from the CLI:** `npm login` (verify with `npm whoami`).

## Ongoing releases

Bump the changed packages, rebuild, and publish. Two paths:

**A. Changesets (preferred for changelogs):**

```bash
pnpm changeset            # describe your change + choose bump (patch/minor/major)
pnpm version-packages     # apply version bumps + update changelogs
pnpm release              # build, then changeset publish
```

**B. Manual (what recent releases used):** bump `version` in each changed package's
`package.json`, then:

```bash
pnpm build                                                  # rebuild (core injects its version at build)
pnpm -r publish --dry-run --no-git-checks --access public   # verify tarball contents first
# publish in dependency order so consumers resolve: core → create-avalanche-app → mcp
pnpm --filter @avakit/core publish --no-git-checks --access public
```

`pnpm` automatically rewrites `workspace:*` dependencies to the real versions
(e.g. `@avakit/mcp` → `@avakit/core@0.1.3`) in the published tarballs.

> Note: `create-avalanche-app`'s `AVAKIT_DEP_VERSION` (the `^` pin stamped into scaffolded apps)
> is separate from package versions — keep it at the **lowest** published `@avakit/*` version so
> `^x` resolves every `@avakit/*` package. Templates ship a `pnpm-workspace.yaml` with
> `minimumReleaseAgeExclude: ['@avakit/*']` so a freshly published `@avakit/*` isn't blocked by
> pnpm's supply-chain age gate for its first ~2 days.

## What ships in each package

- `@avakit/core` — `dist/` (ESM + types), `README.md`, `LICENSE`. `@web3auth/modal` is an **optional** peer dependency.
- `@avakit/react` — `dist/`, `README.md`, `LICENSE`. Peer deps: `react`, `react-dom`.
- `@avakit/mcp` — `dist/`, `README.md`, `LICENSE`. Bin: `avakit-mcp`.
- `create-avalanche-app` — `dist/` + `templates/`, `README.md`, `LICENSE`. Bin: `create-avalanche-app`.

## Notes

- Node `>=20.11` is declared via `engines`.
- npm **provenance** (`--provenance`) requires publishing from CI with OIDC; skip it for local publishes.
- After every publish, smoke-test the real flow: `npm create avalanche-app@latest my-app` in a clean directory, then `pnpm install && pnpm build`.
