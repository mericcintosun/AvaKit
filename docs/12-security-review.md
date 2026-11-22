# 12 — Security Review (Phase 1)

Date: 2026-07-02. Scope: full-history secret scan, published npm tarballs, the Studio
local server, embedded-bytecode provenance, and a dependency audit. Tooling: gitleaks
8.30.1, trufflehog 3.95.7, `npm pack`, `pnpm audit`, and a from-source recompile.

## Summary

No real secrets were ever committed or published. One hygiene defect was found (stray
Foundry build artifacts inside a published template tarball) and fixed. The Studio server
is well hardened; one low-severity defence-in-depth gap was closed. All embedded contract
bytecode is faithfully reproduced from its stated upstream sources — no tampering.

## Findings & fixes

### A. Secret scan (git history + working tree + tarballs) — CLEAN
- gitleaks over all history: the only hit is the **EWOQ key** (`0x56289e99…8027`), which
  is Avalanche's well-known **public** local-devnet key, already commented as local-only.
- trufflehog over all history: 0 verified credentials.
- `.npmrc` contains no token; the publish credential is not in the repo.
- No `.env` (non-example) files and no non-EWOQ secrets in any published tarball.

### B. Published npm tarballs
- `@avakit/core`, `@avakit/react`, `@avakit/mcp`, `@avakit/studio`: clean (only
  `dist/`, `README`, `LICENSE`, `package.json`). No secrets, no path leaks, no stray files.
- **`create-avalanche-app@0.1.7`** shipped stray Foundry build output inside the
  `icm-messenger` template (`contracts/out/*.json`, `build-info/`, `cache/`). Not a
  secret — compiled ABI/bytecode JSON with no paths — but unintended, and copied into
  every scaffolded app. **Root cause:** npm's `files: ["templates"]` allowlist packs
  on-disk files even though the root `.gitignore` skips them.
  **Fix:** removed from the working tree; added `packages/create-avalanche-app/.npmignore`
  excluding `templates/**/contracts/{out,cache,broadcast}`; added Foundry `cache/` +
  `broadcast/` to the root `.gitignore`; verified clean with `npm pack --dry-run`.
  Republished as `create-avalanche-app@0.1.8` (0.1.7 not deprecated — no security impact).

### C. Studio local server — hardened, one gap closed
Confirmed strong posture: binds `127.0.0.1` only, validates the `Host` header
(anti-DNS-rebinding), gates every `/api/*` call behind a per-session token injected into
the served page, serves static assets with a path-traversal guard, and runs external
tools only via `spawn`/`execFile` with **fixed argument arrays (never a shell)**;
request-derived values (L1 name/chainId/token/amount) are whitelist-validated before
reaching argv.
- **Low-severity gap (fixed):** `fuji.ts` `keyAddress()` used a request-derived `name`
  in a filesystem path without validation (reachable via `/api/fuji/balance`).
  Token-gating makes it non-exploitable remotely, but it violated the project's own
  invariant. Added an `isValidL1Name(name)` guard. Shipped in `@avakit/studio@0.1.5`.

### D. Embedded-bytecode provenance — no tampering
Recompiled `token-bridge`'s `lib/ictt-artifacts.json` from `ava-labs/icm-contracts`
(non-upgradeable, tag v1.0.9; OpenZeppelin 5.0.2) with **solc 0.8.25, optimizer runs=200,
`evmVersion: cancun`**. All four contracts are a **code-section match** (byte-for-byte
identical except the trailing IPFS metadata hash, which legitimately varies per build):
ERC20TokenHome (20491 B), ERC20TokenRemote (22211 B), TeleporterRegistry (4042 B), and
the demo token (1675 B — this one is the repo's own `AvaKitToken.sol`). Note: the artifacts
target **Cancun** (they use the `MCOPY` opcode); this is now documented in the template's
`CLAUDE.md`. `eerc-token` embeds no bytecode (it uses `@avalabs/eerc-sdk` + CDN circuits
pinned to a commit), so there is nothing to reproduce there.

### E. Dependency audit (`pnpm audit`)
6 advisories, all confined to non-published surfaces: `js-cookie`/`uuid`/`elliptic` via
`examples/hello-avax`'s Web3Auth tree, `postcss` via `apps/web`→Next (build-only),
`esbuild` via `packages/core`→tsup (dev/build-only), and `ws` via viem (viem's default
HTTP transport does not use ws, so the DoS does not apply). No advisory is exploitable in
the shipped runtime packages. Follow-ups (non-blocking): bump `@web3auth/modal` in the
examples; consider a pnpm override for `ws`.

## Repo hygiene (Task 11)
- Root `.gitignore` gained Foundry `cache/`/`broadcast/` and `.claude/settings.local.json`.
- The one stray tracked file (`icm-messenger/contracts/cache/solidity-files-cache.json`)
  was removed from the working tree (staged deletion to be committed).
- Fixed 4 pre-existing lint errors that were failing `pnpm lint` (CI): import sort +
  format in `examples/web3auth-demo`, and a `DataView`→`DataPanel` rename in Studio's UI
  to stop shadowing the JS global.

## Bonus: version drift
The MCP handshake reported a stale `0.1.0` for both `@avakit/mcp` and `@avakit/studio`.
Root cause: hand-synced version constants. All packages now derive their version from
`package.json` (runtime read for the Node CLIs/servers; build-time `define` for the
browser libs), removing the manual sync step from the release process entirely.

## Republished
`create-avalanche-app@0.1.8`, `@avakit/mcp@0.1.8`, `@avakit/studio@0.1.5`.
`@avakit/core@0.1.2` and `@avakit/react@0.1.3` unchanged (version value identical; the
source refactor ships on their next release).

---

# Addendum — November 2026 review (2026-11-18)

A second review covered all five packages, the eight templates, the two Workers under
`services/` and the release pipeline, in two rounds. This addendum lists what it found
and what changed, by package. The detail is in the changesets named in the last column.
They were released by the version commit c9ec4af, and their entries are under
`@avakit/core` and `@avakit/react` 0.2.2, `create-avalanche-app` 0.4.2, `@avakit/mcp` 0.2.0
and `@avakit/studio` 0.1.14 in each package's `CHANGELOG.md`, each marked with the commit
that added the changeset (`git log --diff-filter=A -- .changeset/<name>.md`).

## Findings and fixes, by package

| Package | What the review found | What changed | Changesets |
| --- | --- | --- | --- |
| [`@avakit/core`](../packages/core/CHANGELOG.md) | `deployContract` reported a deployment whose transaction had reverted. A confirmed mainnet deploy had no balance check. A chain definition without a `testnet` flag was not treated as a mainnet. A faucet request could hang, and a failure carried no code to tell a refusal from an outage. | A deployment is accepted only with a successful receipt and code at the address (`waitForDeployment`). A confirmed mainnet deploy checks the balance first. Only `testnet: true` makes a testnet. `requestFaucet` has typed failures, a bounded retry and a time limit. | `core-react-core-hardening`, `r2-core-react-faucet-deploy-links` |
| [`@avakit/react`](../packages/react/CHANGELOG.md) | The published bundle had lost its `"use client"` directive. The provider did not follow the wallet's account, network and disconnect events, and could keep a burner wallet connected on a mainnet. The data hooks showed a previous account's items. | The directive is kept and checked at build time, with a server-safe `@avakit/react/utils` entry. The provider follows the wallet's events and drops a burner on a mainnet. The data hooks page and reset per account. | `core-react-react-hardening`, `r2-core-react-faucet-deploy-links` |
| [`create-avalanche-app`](../packages/create-avalanche-app/CHANGELOG.md) (CLI) | A failed install was still reported as done. Unknown flags and values were replaced by defaults. Any template could be scaffolded for C-Chain. Build output or `.env` files left in a template directory could be published and copied into new apps. | Every spawned command is checked and a failed install exits non-zero. Unknown flags and values are errors. Only `minimal` lists `c-chain`. `files` in `package.json` excludes build output and env files, replacing the `.npmignore` this document's section B introduced. Node.js below 22 is refused in one line (the floor its wizard library requires). | `cli-mcp-scaffolder-hardening`, `r2-e2e-node-preflight` |
| `create-avalanche-app` (templates and their contracts) | A mainnet scaffold offered the burner wallet and the shared demo Web3Auth client ID. The ICM messenger accepted a zero origin sender from an unregistered chain and had no message length cap. The devnet scripts hardcoded the public EWOQ key. `foundry.toml` did not pin the EVM version, so `forge build` could not reproduce the bundled bytecode. The NFT's on-chain description made claims that were not true of every deployment. | A mainnet scaffold has neither. The messenger rejects that sender and caps messages at 256 bytes. The scripts read the key from avalanche-cli. Every `foundry.toml` pins solc and `cancun`. The description is neutral. | `templates-app-and-script-fixes`, `contracts-template-hardening`, `gatefix-contracts`, `r2-templates-fuji-faucet` |
| [`@avakit/mcp`](../packages/mcp/CHANGELOG.md) | `deploy_contract` returned the address of a contract that was never created when the transaction reverted. `scaffold_app` could create a project anywhere the user could write. The mainnet gate `AVAKIT_ALLOW_MAINNET` was not documented. The registry listing advertised minting when no tool could mint. | A reverted or code-less deployment is an error. `scaffold_app` and `artifactPath` are confined to the working directory or `AVAKIT_MCP_ROOT`. The gate is documented and also applies to the new `write_contract`. A test ties the listing's wording to what the tools do. | `cli-mcp-server-hardening`, `r2-mcp-zero-setup-fuji` |
| [`@avakit/studio`](../packages/studio/CHANGELOG.md) | A malformed request could crash Studio. A failed step was reported as success. An action belonged to the browser tab that started it and was started from a GET. The messenger bytecode was copied in by hand. | Requests are validated and answered with an error. A failed step is reported as one. Actions belong to the server, run one at a time and start from a JSON POST. The messenger bytecode is generated and checked in CI. | `studio-review-hardening`, `contracts-studio-messenger` |

Not npm packages, so no changeset; the changes are in the repository:

| Area | What the review found | What changed |
| --- | --- | --- |
| `services/faucet` | Rate limits were counted in KV, where parallel requests can all pass before any is recorded. Concurrent drips could sign the same nonce. A contract recipient could make a drip burn gas. Refusals had no machine-readable code. | Limits and the send queue live in a Durable Object. A transaction whose answer was lost is looked up by hash. Contract recipients are refused. Every refusal is `{ error, code }`. A Turnstile check is optional. Deployed on 2026-11-19. |
| `services/telemetry` | The collector counted any well-formed template id, and there was no way to remove the project's own test events. | Only known template ids are accepted. `POST /admin/purge`, behind `TELEMETRY_ADMIN_TOKEN`, removes a day. Deployed on 2026-11-19, when the 52 test events of 2026-11-18 were removed and the route switched off again. |
| `contracts-ci` | The artifact check covered the five templates' own artifacts only. Studio's messenger bytecode, the website's and the example app's artifacts and `token-bridge`'s demo token were compared with nothing. | `check-artifacts.mjs` compared nine artifacts in CI after this review, and compares twelve since `token-bridge`'s three `ava-labs/icm-contracts` entries were added (see the correction to section D below). It fails on an artifact file it has not been told about, and regenerates them with `--write`. `sync.mjs` refuses a `foundry.toml` whose compiler settings differ from the harness's. |
| `.github/workflows` | The release job published whatever built, and the version PR gets no CI run of its own. | The release job runs lint, typecheck and tests before it versions or publishes. `e2e-fuji.yml` runs the published packages end to end. The version PR's own CI runs once a maintainer approves its runs ([`RELEASING.md`](../RELEASING.md), "The version PR's checks"). |

## What the release adds that touches keys

This document's Phase 1 summary rests on "AvaKit code never handles a private key"
with one exception, the in-browser burner wallet. The release that follows this review
adds a second: `@avakit/mcp` signs Fuji transactions with a **session test wallet**
when `AVAKIT_DEPLOYER_KEY` is not set. The key is generated in the server's memory, is
never written to disk, logged or returned, signs for chain id 43113 only, never sends
value, and is gone when the server stops. [`SECURITY.md`](../SECURITY.md) describes
both exceptions and their limits.

## Corrections to the Phase 1 text above

- **Section B.** The `.npmignore` it describes is gone. The same exclusions, and more,
  are negated entries of `files` in `packages/create-avalanche-app/package.json`,
  tested by `src/pack.test.ts`.
- **Section C.** "Fixed argument arrays" is not exact. Studio runs external tools with
  argument arrays **built from validated values**, never through a shell. An
  Interchain message is checked (non-empty, at most 256 bytes of UTF-8, no leading
  `-`) and goes out only as ABI-encoded calldata: Studio 0.1.14 hands that calldata to
  `cast`, and from the release after 0.1.14 Studio signs and sends the transaction
  itself, so no command line carries the message or the EWOQ key.
- **Section D.** The `DemoToken` entry of `token-bridge`'s `lib/ictt-artifacts.json`
  is now rebuilt and compared in CI, and so are the three `ava-labs/icm-contracts`
  entries: `contracts-ci` builds them from the upstream sources it pins
  (`contracts-ci/upstream/icm-contracts/`) and compares every byte, the metadata hash
  included.

## Still open

The review did not close everything. What was open on 2026-11-18 is in the section
"Open on 2026-11-18" of the known-gaps file of that time,
`git show 8e2ed22:docs/KNOWN-GAPS.md`: among others the public EWOQ key literal in
Studio and the dependence of three templates and Studio on Avalanche CLI. The faucet
and collector changes, open on that day, were deployed on 2026-11-19. What is open now
is listed in [`KNOWN-GAPS.md`](KNOWN-GAPS.md).
