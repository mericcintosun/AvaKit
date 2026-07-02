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
