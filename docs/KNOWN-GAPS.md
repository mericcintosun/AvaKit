# AvaKit — Known Gaps & Fragilities

> Snapshot from a full-repo review (2026-07-04). Ordered by risk. This is an
> engineering to-do list, not user-facing docs. Update or delete items as they
> are fixed.
>
> **2026-07-04 follow-up pass:** items 1–5 and 8 are now fixed (see below). The
> changes ship in `@avakit/core`, `@avakit/react`, and `create-avalanche-app`.
>
> **2026-07-15 re-verification:** every item below was re-checked against the code.
> Items **2, 4, 5, 12** were still described as open/partial but are done — their
> bodies are corrected in place. **A1** is closed as moot (not implemented — the
> fallback it warned about no longer exists). **F1** is fixed. **F4 has graduated
> from a smell to a real defect** and is rewritten. Item 5's "29 tests" is now 45.
> Beware: this file has been wrong in both directions — verify before trusting it.

## Critical / user-visible

1. **Social login was silently hidden without a Web3Auth client ID — FIXED.**
   - Before: `providers.tsx` only added `web3authAdapter` when
     `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` was set, so a fresh scaffold showed only the
     injected (Core/MetaMask) button and social login looked missing.
   - Fix: `WalletAdapter` gained an optional `unavailableReason`; `web3authAdapter`
     sets it when no client ID is configured, and `ConnectAvalanche` now renders
     unavailable adapters as a **disabled button with the hint** instead of hiding
     them. The five social-login templates (minimal, nft-mint, token-gated-app,
     erc20-token, eerc-token) always add the adapter, so the option is
     discoverable ("Add NEXT_PUBLIC_WEB3AUTH_CLIENT_ID to enable social login").
     Verified an injected scaffold (no `@web3auth/modal` installed) still
     typechecks and builds.
   - The wiring matches `@web3auth/modal` v11.2.0's real API (`init()` →
     `connect()` → `Connection.ethereumProvider`, checked against the installed
     SDK types). `web3authAdapter` now has unit tests.
   - **Still open:** a full Google sign-in → Fuji chain-switch has not been
     machine-validated (it needs a human browser login). Test it manually before
     relying on it in a demo.

2. **Mint (and other writes) did not reflect success in the UI — FIXED.**
   - Root cause: `contract.write(...)` returns the tx hash right after broadcast;
     the templates then re-read `totalSupply`/`balanceOf` immediately, racing the
     still-pending tx, so the counts stayed stale and the mint looked like it did
     nothing. A silent on-chain revert was also swallowed.
   - Fix: after `write`, wait for the receipt via
     `getPublicClient(chain).waitForTransactionReceipt({ hash })`, throw on
     `status === "reverted"`, then refresh. Applied to `nft-mint` +
     `token-gated-app` templates and `examples/web3auth-demo`. Smoke-tested.
   - **Still open:** `erc20-token` still uses the raw `write` pattern; the durable
     fix is to bake receipt-waiting into `useContract` in `@avakit/react`.

3. **Mainnet deploy guard was not enforced in core — FIXED.**
   - Before: `deployContract` had no testnet check, so a browser/`@avakit/react`
     caller could deploy to `cChain` (mainnet) unguarded, despite the docs.
   - Fix: `DeployParams` gained `confirmMainnet?: boolean`; `deployContract` throws
     `MainnetConfirmationError` for any `chain.testnet === false` unless
     `confirmMainnet: true` is passed. `useAvaDeploy().deploy(artifact, args, {
     confirmMainnet })` threads it through. Fuji (testnet) is unaffected. Covered
     by tests.

## Testing

4. **`@avakit/react` had zero tests — PARTIALLY FIXED.**
   - Added `utils.test.ts` (11 tests) covering `cn`, `shortenAddress`, and every
     `humanizeError` branch. The provider/hooks/component render paths are still
     untested (would need a jsdom + Testing Library harness) — follow-up.

5. **`@avakit/core` coverage was thin — IMPROVED.**
   - Added `errors.test.ts`, `network.test.ts` (`ensureChain`), and
     `adapters/web3auth.test.ts`, plus the mainnet-guard cases in `deploy.test.ts`.
     Core is now at 29 tests (was 15). Still untested: `data.ts` (RPC helpers).

6. **No integration / e2e coverage.** Smoke tests only scaffold→install→
   typecheck→build. No test drives connect → deploy → mint against a chain, so a
   regression in the mint/deploy flow would not be caught by CI. Follow-up: a
   headless viem/anvil-backed test, or a Playwright flow with a mock provider.

## Fragility

7. **`humanizeError` is brittle string matching.** `packages/react/src/utils.ts`
   maps errors by substring on lowercased messages. Now unit-tested, but still
   breaks on wallet wording changes / localization — the tests will at least flag
   a regression.

8. **`ensureChain` 4902 handling — now tested.** Still relies on numeric
   error-code matching across heterogeneous wallets, but `network.test.ts` locks
   in the switch / add-then-switch / rethrow behavior.

9. **viem overload escape hatches.** `as never` / `as Parameters<...>` casts in
   `deploy.ts`, `data.ts`, and `hooks.ts` (`useContract`, `useSendTransaction`)
   drop type-safety at those call sites to satisfy viem generics. Intentional;
   revisit if viem's typings improve.

10. **Web3Auth SDK is structurally typed**, not using the real SDK types — a
    version bump in `@web3auth/modal` could silently break the adapter with no
    type error. Intentional (keeps the optional dep out of the build), but the
    adapter tests only cover availability, not a live connect.

## Housekeeping

11. **Stale build artifacts.** `.turbo/turbo-test.log` files lag the package
    versions — harmless cache drift, gitignored.

12. **`data-api.ts` past 404 bug** (chain-object vs id) is only documented in a
    comment; worth a regression test given the API surface evolved.

13. **Version constant only correct in built artifacts.** `VERSION` is injected
    at build time; raw `tsc`/`vitest` yields `"0.0.0-dev"`. Expected.

---

# 2026-07-15 — full-repo review (all 5 packages + templates + website)

> Second-pass audit covering everything the 2026-07-04 snapshot did not:
> `create-avalanche-app`, `@avakit/mcp`, `@avakit/studio`, all 8 templates, and
> `apps/web`. Grouped by area, ordered by risk within each group. None of these
> are release blockers (0.x is shipped and proven on Fuji); they are the next
> tier of engineering debt. File:line refs are from this review — verify before
> editing.

## A. Scaffolding correctness

A1. ~~**MCP-scaffolded apps get the wrong `@avakit/*` version floor.**~~ **CLOSED —
   moot, no code change needed.** This was real when `scaffoldApp`'s fallback was an
   orphan `"0.1.0"` literal. `AVAKIT_DEP_VERSION` now lives in `api.ts` as the single
   source of truth and *is* the fallback (`opts.avakitVersion ?? AVAKIT_DEP_VERSION`),
   so the MCP omitting the argument yields the identical pin the CLI passes
   explicitly. Passing it from the MCP would be a no-op that re-introduces a second
   call site able to drift. The live risk moved entirely to **A2**.
   Low impact today (`^0.1.0` still resolves to the latest published 0.1.x =
   0.1.6), but it diverges from the CLI and defeats the point of the pin. Fix:
   pass `avakitVersion` from MCP, or export the constant from `./api` and use it
   as the shared default.
   **FIXED (2026-07-15):** MCP now inherits the shared pin via the scaffolder
   default (see A2) — no code change needed in MCP.

A2. **`AVAKIT_DEP_VERSION` is a hand-maintained magic constant** decoupled from
   the CLI's own version (`packages/create-avalanche-app/src/index.ts:22`), and
   `api.ts:82` has an unrelated fallback default `"0.1.0"`. Both must be bumped by
   hand on every core/react release; nothing enforces they stay in sync with the
   published versions. Consider deriving the pin from the published core version
   at build time.
   **FIXED (2026-07-15):** `AVAKIT_DEP_VERSION` now lives in
   `create-avalanche-app/src/api.ts` as the default `scaffoldApp` uses and the
   CLI imports — one source of truth for both scaffolding paths. Set to **0.2.0**
   for the burner-wallet release. **Watch out:** a `minor` changeset on a 0.x
   package publishes 0.1.x → **0.2.0**, not 0.1.7 — pinning a version Changesets
   never publishes makes every scaffold fail to install, so always confirm the
   bump on `changeset-release/main` before release. (Auto-deriving the pin from the
   published version would remove this footgun for good.)

## B. Testing (whole packages untested)

B1. **`create-avalanche-app`, `@avakit/mcp`, and `@avakit/studio` have zero
   tests.** No `*.test.*` / `vitest.config.*` under any of the three; all declare
   `"test": "vitest run --passWithNoTests"`, so `pnpm test` is a green no-op that
   masks the gap. This is despite security-sensitive logic: Studio arg
   validation, path-traversal guard, session-token gating, CB58 decoding; the
   scaffolder's placeholder replacement and dot-segment renaming; the MCP tools.
   Typecheck is the only real gate.

B2. **No integration / e2e coverage anywhere** (carried over from item 6). Nothing
   drives connect → deploy → mint against a chain, or scaffold → install → run.

## C. `@avakit/studio`

C1. **Hardcoded EWOQ private key in source** (`packages/studio/src/icm.ts:25`).
   It is the well-known public local-devnet key and only used against local
   chains, but it is a literal private key committed to the repo and passed on the
   `cast` command line (visible in process listings). Document loudly / centralize.

C2. **`detached: true` orphan processes** (`devnet.ts:260`, `fuji.ts:285`):
   avalanche-cli children intentionally outlive Studio, so stopping Studio can
   leave a running local network/validator with no obvious owner and no "stop
   everything" affordance.

C3. **`token` vs `symbol` query-param split is a latent landmine**
   (`server.ts:130-132`, `api.ts:110`, `fuji.ts` note): the L1 native-token symbol
   once collided with the session-auth `token` param and broke the Fuji deploy;
   the workaround is comment-guarded only.

C4. **Fuji deploy depends on avalanche-cli's interactive prompt behavior**
   (`fuji.ts:216-222` relies on stdin being closed to auto-skip the "fund
   relayer?" prompt). A CLI update could hang or change the flow.

C5. **Side-effecting GET SSE routes, session-token as the only CSRF defense.**
   `GET /api/devnet/stream` spawns avalanche-cli via a GET (EventSource can't
   POST); same-origin + `x-studio-token` is the whole defense. Acceptable for a
   localhost tool, but unconventional.

C6. **`getFujiKeyBalance` does lossy integer math on wei**
   (`fuji.ts:82`, `Number(wei / 1e12n) / 1e6`) to avoid a bignum dep — truncates;
   display-only, fine for now.

C7. **`messenger-artifact.ts` is a hand-copied build artifact** with only a
   comment on how to regenerate — can silently drift from the `icm-messenger`
   template's Solidity source.

## D. `@avakit/mcp`

D1. **`deploy_contract` uses `as never` casts** (`mcp/src/index.ts:~159,~254`) to
   bypass viem's generics — brittle if viem's `deployContract`/`readContract`
   signatures change.

D2. **`estimate_gas` loses precision on large costs** — computes AVAX cost as
   `Number(costWei) / 1e18`. Display-only, but note it.

## E. `@avakit/core` / `@avakit/react` (beyond the 2026-07-04 items)

E1. **`viem` is a devDependency-only in `@avakit/react`.** Works today purely
   because every viem import in react is type-only (erased at build) and runtime
   viem arrives transitively through `@avakit/core`. Adding any runtime viem value
   import to react would silently break consumers who don't independently install
   viem. Make viem a real peer dep, or keep a lint rule forbidding value imports.

E2. **No connection persistence / auto-reconnect** in `AvaKitProvider` — state is
   in-memory only, so a reload drops the wallet. Adapters expose `on` /
   `removeListener` but the provider never subscribes to `accountsChanged` /
   `chainChanged`.

E3. **Data hooks silently drop pagination.** `DataApiOptions` plumbs
   `pageSize`/`pageToken` through core, but `useTokenBalances`/`useNfts`/
   `useTxHistory` only read the first page and discard `nextPageToken`.

E4. **shadcn "style-only" shipping model** (ADR-012): `@avakit/react` emits
   Tailwind token classes and renders unstyled if the consumer hasn't configured
   shadcn tokens — documented but easy to miss.

E5. **`ReadContractParams` (`data.ts`) and `ChainRef` (`data-api.ts`) are not
   exported**, so consumers can't name them.

E6. **No AvaCloud WaaS wallet adapter.** ADR-004 lists it as an opt-in wallet, but
   only `injected` and `web3auth` exist; "AvaCloud" ships solely as the Glacier
   Data API. Either build the adapter or drop it from the positioning docs.

## F. Templates

F1. **`l1-launch` stale references a non-existent file.** `templates/l1-launch/lib/l1.ts`
   and its `CLAUDE.md` point at `components/explorer.tsx`, but the explorer is
   inlined in `components/demo.tsx` — no such file exists.

F2. **`eerc-token` demo Mint reverts for most users.** It points at a *shared*
   pre-deployed Fuji eERC whose `privateMint` is `onlyOwner`; minting only works
   if you deploy your own instance and connect as its deployer (documented, but
   the Mint button will fail out of the box). Also: circuits are fetched from a
   commit-pinned jsDelivr CDN (2–14 MB, network-dependent), and `wagmi` is pinned
   to 2.x, intentionally off the repo's "latest stable" rule.

F3. **Cross-chain "in flight" UX is timing-heuristic.** `token-bridge` uses a
   hardcoded `setTimeout(…, 12000)` and `deploy-bridge.mjs` a fixed `sleep(8000)`;
   `icm-messenger` clears the banner when the destination inbox string matches, so
   sending identical text twice can clear it prematurely.

F4. **Source/artifact duplication — the drift it warned about already happened.**
   `AvaKitToken.sol` is still byte-identical between `erc20-token` and `l1-launch`
   (a clean copy, low risk). The NFT half went wrong: `nft-mint`'s contract was
   rewritten (on-chain SVG art) and its artifact regenerated, and **that artifact was
   copied into `token-gated-app` while its `.sol` was left behind** — so
   `token-gated-app` shipped a source file that did not correspond to the bytecode
   its own app deploys (source had `supportsInterface` + `pure tokenURI`; the shipped
   ABI had neither). No runtime break, because the app only calls `mint`/`balanceOf`
   — but its `CLAUDE.md` tells the agent to edit that source and recompile, which
   would have silently replaced the deployed contract.
   **2026-07-15: realigned** `token-gated-app`'s source to the artifact it ships.
   The underlying gap stands: two copies with no shared source of truth, and nothing
   that fails when a `.sol` and its `lib/*-artifact.ts` disagree. A check that
   recompiles and diffs the artifact would catch the next one.

F5. **Setup templates need external tooling and only run locally.** `icm-messenger`,
   `l1-launch`, `token-bridge` require `avalanche-cli` and ship
   `*.config.json` as `configured:false` placeholders (a `SetupPanel` blocks the
   app until the one-command script runs). Scripts use `set -uo pipefail` (no `-e`).

F6. **Bundled Solidity is intentionally minimal (not production).** `AvaKitNFT.sol`
   is deliberately not a full ERC-721 (no transfer/approve); the ERC-20 `mint` is a
   public faucet with no access control. Fine for demos; flag before anyone copies
   it to prod.

## G. `apps/web` (website)

G1. **next-intl message files are empty.** `messages/en.json` and `messages/tr.json`
   are both `{}` while `NextIntlClientProvider` is fed `getMessages()`. All real
   bilingual copy lives in `lib/content.ts` instead, so the entire next-intl
   message layer is vestigial — any component calling `useTranslations`/`t()` would
   fail (none do yet).

G2. **The `/avatar` 3D-mascot feature is unfinished and untracked.**
   `app/[locale]/avatar/` + `public/3d/` are new, uncommitted, and not linked from
   nav / command menu / sitemap. It loads Google `<model-viewer>` from a CDN at
   runtime (external dependency, no offline/SRI fallback), and the
   `fox-loop.webm` / `core-loop.webm` assets aren't referenced by the page.
   **FIXED (2026-07-15):** committed; `<model-viewer>` is now a real npm
   dependency, imported client-side and code-split to `/avatar` alone (a ~1 MB
   chunk, out of the main bundle) — no external CDN at runtime. `/avatar` is
   linked from the site footer. The two `*-loop.webm` files are intentionally kept
   as the social-ready mascot loops (see `docs/launch/content-calendar-v2.md`
   post 9); they are brand assets, not page assets.

G3. **Hidden pages have no inbound links.** `/terminal`, `/pitch`, `/avatar` are
   reachable only by direct URL (not in header, mobile sheet, command menu, or
   sitemap). `/pitch` is a grant deck ("Team1 Mini Grant") — arguably intentional.
   **PARTIALLY FIXED (2026-07-15):** `/avatar` is now linked from the footer.
   `/terminal` and `/pitch` remain deliberate direct-URL-only pages.

G4. **Copy inconsistency: "four surfaces" vs "five surfaces/packages."** The layout
   and docs say "one core, four surfaces" (= 5 packages); the pitch deck / npm
   counts say five. Pick one framing.

G5. **No test/lint gate beyond Biome + `tsc`** in `apps/web`; no `test` script.

G6. **Hardcoded external config in `lib/content.ts`** (GitHub, a YouTube tutorial
   URL, a Google Forms feedback link, `SITE_URL`), overridable via `NEXT_PUBLIC_*`
   but baked in as defaults.

## H. Cross-cutting

H1. **The ASCII banner is duplicated 5×.** Three byte-identical `banner.ts`
   (`create-avalanche-app`, `mcp`, `studio`) plus two inline React re-embeds of the
   same art (the Ink wizard `Banner()` and Studio's `BootSplash`). Intentional per
   the file headers, but a copy-paste hazard — a shared `@avakit/brand` asset would
   remove the drift risk.
