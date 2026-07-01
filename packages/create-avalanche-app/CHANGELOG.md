# create-avalanche-app

## 0.1.4

### Patch Changes

- Finish the pnpm fix for scaffolded apps on pnpm 11: the `pnpm` field in `package.json` is no longer read by pnpm 11, so approve native build scripts via a shipped `pnpm-workspace.yaml` (`allowBuilds`) instead — `sharp` for every template, plus `blake-hash`/`keccak`/`bufferutil`/`utf-8-validate` for `eerc-token`'s crypto stack. Also exempt AvaKit's own packages from pnpm's supply-chain minimum-release-age gate (`minimumReleaseAgeExclude`) so a freshly published `@avakit/*` never blocks a new app's first `pnpm install`.

## 0.1.3

### Patch Changes

- Add the `eerc-token` template — a confidential-token dapp built on Avalanche's Encrypted ERC (eERC) standard (register, private mint, confidential transfer, private burn with hidden balances), proven live on Fuji. Also fix `pnpm dev` on freshly scaffolded apps under pnpm by shipping a `pnpm-workspace.yaml` that pre-approves native build scripts (`sharp`), so the dev server starts without an `ERR_PNPM_IGNORED_BUILDS` failure. The MCP `scaffold_app` tool now lists `eerc-token` (and backfills `icm-messenger`).

## 0.1.2

### Patch Changes

- Scaffolded apps that use the social-login wallet now include `@web3auth/modal` in their dependencies, so `web3authAdapter` can actually load at runtime (previously the optional peer was never added, so choosing the Web3Auth wallet produced an app that couldn't initialize social login).

## 0.1.1

### Patch Changes

- f9c9040: Add the `icm-messenger` template: send a message between two Avalanche L1s using Interchain Messaging (ICM / Teleporter), against a one-command local devnet. Ships a send/receive `AvaKitMessenger` contract, a `scripts/devnet.sh` that spins up two local L1s with ICM + a relayer, and a UI that deploys on both chains and watches a message cross over.
