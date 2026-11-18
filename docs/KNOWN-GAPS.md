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
>
> **2026-11-18 re-verification:** a review found that several bodies below still
> described closed gaps as open — among them items 2, 4, 5 and 12, which the note
> above says were corrected. They are corrected in place now, each one re-checked
> against the code: items **2, 4, 5, 12**, **B1**, **E6**, **F1**, **F2**, **F3**,
> **F4** and **F6**. Nothing was added in this pass.
>
> **2026-11-18 release pass (after both review rounds):** the section right below
> is new and lists what is open on the day of the release, in one place. Items
> **4, 5, 6**, **B1**, **B2**, **C1**, **C2**, **C3**, **C5**, **C7**, **D1**, **D2**,
> **E2**, **E3**, **F3**, **F4**, **F5** and **G3** were re-checked against the code
> and corrected in place.
> Every other body is as the earlier passes left it and was **not** re-checked in
> this one.

## Open on 2026-11-18

The short list. Each item is one or two sentences; the older sections below have
the detail where there is any.

**Tooling and infrastructure**

- **Avalanche CLI is in maintenance mode.** The `icm-messenger`, `l1-launch` and
  `token-bridge` templates and `@avakit/studio` drive Avalanche CLI, which Ava Labs
  put in maintenance mode in December 2025 and removed from the Avalanche
  documentation on 2026-10-06 in favour of Platform CLI. They were last proven end
  to end in July 2026 (Avalanche CLI 1.9.6); their scripts have changed since
  without a full run on a live network, and the move to the supported toolchain
  has not been done.
- **The faucet Worker's hardening is not deployed.** `services/faucet` has exact
  limits in a Durable Object, queued sends, a lookup by hash when the node's answer
  is lost, a refusal of contract recipients and an optional Turnstile check. The
  hosted faucet still runs the earlier Worker, whose limits are counted in KV and
  are a floor, not a guarantee. Deploying is a manual `wrangler deploy` by the
  owner (`services/faucet/README.md`, "First deploy of this version").
- **The telemetry collector's changes are not deployed, and test events are in the
  public count.** On 2026-11-18 local smoke tests wrote 52 scaffold events into the
  production collector, because `scripts/smoke-template.sh` did not opt out. The
  script now sets `AVAKIT_TELEMETRY_DISABLED=1` itself. The events are still counted
  on avakit.dev/stats until the owner deploys `services/telemetry` and removes that
  day with `POST /admin/purge` (`services/telemetry/README.md`, "Removing test
  events"). The purge removes a whole UTC day, so real scaffolds of that day go
  with it.
- **Single maintainer.** One person reviews and releases, and pays for and
  operates the faucet and the telemetry collector. There is no second reviewer,
  and no response time is promised beyond the intention stated in `SECURITY.md`.

**Validation**

- **No external users validated yet.** Nobody outside the project has been
  observed going through a first run. The flows are proven by the maintainer and
  by scripts, and the public usage numbers are small.
- **Native Windows is not exercised by a person.** One leg of
  `.github/workflows/e2e-fuji.yml` (windows-latest, Node 24) scaffolds `nft-mint`
  through the MCP server and builds it with npm; nothing goes further there. The
  setup scripts of the three local-devnet templates are bash and need WSL2.
- **No test drives a browser.** `scripts/e2e-fuji.mjs` covers scaffold → build →
  deploy → mint through the MCP server on Fuji (see item 6). Connecting a wallet
  and clicking Deploy and Mint in a scaffolded app, and the Google sign-in of the
  social login (item 1), are still checked by hand only.

**Dependencies**

- **The eERC template is pinned to an older upstream commit.** `eerc-token` loads
  its circuits and builds its contracts from `ava-labs/EncryptedERC` at
  `c7eb0e09bc9315e68c35d3c09f5dce4b794d0485`. Upstream merged security fixes with
  regenerated verifier keys on 2026-08-31 that are not in a tagged release; the
  template has not been moved to them and is testnet-only.
- **Major-version upgrades are pending.** The repository is on TypeScript 6,
  Vitest 4, Vite 7, tsup 8, Ink 7, framer-motion 12 and (in `eerc-token` only)
  wagmi 2. The November review recorded a newer major of each as available
  (TypeScript 7, Vitest 5, Vite 8, tsup 9, Ink 8, framer-motion 14, wagmi 3); none
  has been tried.
- **`token-bridge/lib/ictt-artifacts.json` is only partly checked.** Its
  `DemoToken` entry is rebuilt and compared in CI. The other three entries
  (`ERC20TokenHome`, `ERC20TokenRemote`, `TeleporterRegistry`) are builds of
  `ava-labs/icm-contracts` with no source in this repository and no automated
  check; they were last recompiled and compared by hand in July 2026
  (`docs/12-security-review.md`, D).
- **`viem` is a dev-only dependency of `@avakit/react`** although its types appear
  in the public API (E1).

**Studio**

- **The EWOQ dev key is a literal in Studio and visible on the `cast` command
  line** (C1), and **avalanche-cli children are detached** and can outlive Studio
  (C2).
- **No lock between the dashboard and a separate `avakit-studio mcp` process.**
  "One action at a time" holds inside one Studio server. A dashboard and an MCP
  process started side by side can each run avalanche-cli at the same moment.

**Conventions and decisions**

- **Website chrome under `/tr`.** The landing page and the templates page are
  translated; the footer's link labels and the command menu stay English under
  `/tr`, and every other page is English-only by design.
- **Tailwind keyframe animations versus the "Framer Motion or GSAP only" rule.**
  All eight templates import `tw-animate-css`, and Studio's UI defines a CSS
  keyframe animation and uses `animate-*` classes. Either the rule gets an
  exception for these or they are replaced.
- **AvaKitNFT's on-chain identity (owner decision pending).** The description in
  `tokenURI` is neutral since this release ("Generated on-chain by the AvaKitNFT
  contract. …"). The collection name ("AvaKit NFT"), the symbol ("AVAKIT") and the
  art's palette are still AvaKit's own in a contract users deploy as theirs.
- **`--passWithNoTests` is still in four test scripts** (`@avakit/core`,
  `@avakit/react`, `@avakit/mcp`, `create-avalanche-app`). All four have tests now,
  so it changes nothing today, but a package whose tests stopped being found
  would pass (B1).

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
   - `erc20-token` now does the same: its `run()` helper waits for the receipt and
     throws on `reverted` for both mint and transfer (`components/demo.tsx`).
   - **Still open (hardening, not a defect):** each template repeats that pattern
     by hand; the durable fix is to bake receipt-waiting into `useContract` in
     `@avakit/react`.

3. **Mainnet deploy guard was not enforced in core — FIXED.**
   - Before: `deployContract` had no testnet check, so a browser/`@avakit/react`
     caller could deploy to `cChain` (mainnet) unguarded, despite the docs.
   - Fix: `DeployParams` gained `confirmMainnet?: boolean`; `deployContract` throws
     `MainnetConfirmationError` for any `chain.testnet === false` unless
     `confirmMainnet: true` is passed. `useAvaDeploy().deploy(artifact, args, {
     confirmMainnet })` threads it through. Fuji (testnet) is unaffected. Covered
     by tests.

## Testing

4. **`@avakit/react` had zero tests — FIXED for the main render paths.**
   - `utils.test.ts` (11 tests) covers `cn`, `shortenAddress`, and every
     `humanizeError` branch.
   - `provider.test.tsx` (7 tests, jsdom + Testing Library) renders the real
     components: `AvaKitProvider` with `useAvaKit` (connect, disconnect, use outside
     the provider), `useBalance`, and `ConnectAvalanche` (an available adapter, an
     unavailable one with its reason, and the burner-first layout).
   - **Since then (re-checked 2026-11-18):** the data hooks
     (`data-hooks.test.tsx`), `useContract`, `useAvaDeploy`, `useSendTransaction`
     and `useFaucet` (`hooks.test.tsx`, `faucet.test.tsx`) and an app on two chains
     (`two-chains.test.tsx`) have tests. The package stood at 118 tests in 6 files.
   - **Still untested:** `TransactionButton`.

5. **`@avakit/core` coverage was thin — IMPROVED.**
   - Added `errors.test.ts`, `network.test.ts` (`ensureChain`), and
     `adapters/web3auth.test.ts`, plus the mainnet-guard cases in `deploy.test.ts`.
   - Since then `data.test.ts` covers the RPC helpers in `data.ts` — the gap this
     item used to end on — and `chains`, `clients`, `data-api`, `coinbase` and the
     burner and injected adapters have test files of their own. Core stood at 49
     tests in 11 files before the November review rounds (it was 15 tests), and at
     201 tests in 13 files after them, with `faucet.test.ts` and
     `adapters/web3auth-missing.test.ts` added.

6. **No integration / e2e coverage — PARTIALLY FIXED (2026-11-18).** Smoke tests
   only scaffold→install→typecheck→build. `scripts/e2e-fuji.mjs` now drives the
   agent path against a real chain: through the MCP server it scaffolds
   `nft-mint`, builds it with npm, deploys the contract on Fuji, mints and reads
   `ownerOf(1)` back. `.github/workflows/e2e-fuji.yml` runs it against the
   published packages daily and on demand (four legs; the on-chain half on one).
   It is not part of a pull request's checks, and a faucet refusal turns its
   on-chain leg red.
   **Still open:** no test drives connect → deploy → mint in a browser, so a
   regression in a template's UI flow would not be caught. Follow-up: a
   Playwright flow with a mock provider.

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

12. **`data-api.ts` past 404 bug** (chain-object vs id) — **FIXED.** It used to be
    documented only in a comment; `data-api.test.ts` now carries the regression
    test ("normalizes a chain object to its numeric id (no [object Object]/404)").

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
   **FIXED (2026-07-16) — for good, auto-derived.** The hand-maintained
   `AVAKIT_DEP_VERSION` is gone. `api.ts` now exports `AVAKIT_CORE_VERSION` and
   `AVAKIT_REACT_VERSION`, each substituted at build time (tsup `define`) from that
   package's real `package.json`, with a sibling-read fallback for source/test runs.
   Templates carry **two** placeholders (`__AVAKIT_CORE_DEP__` /
   `__AVAKIT_REACT_DEP__`) instead of one shared `__AVAKIT_DEP__`, so core and react
   can version independently and each scaffold pins exactly what shipped — the "0.x
   minor → 0.2.0" footgun and the "forgot to bump the constant" footgun are both
   removed. Proven live (react temporarily set to 0.9.9 → scaffold pinned react
   `^0.9.9` and core `^0.2.0` independently) and guarded by
   `create-avalanche-app/src/api.test.ts`. **A1 is also moot** (`scaffoldApp` no
   longer takes an `avakitVersion` override at all).

## B. Testing (whole packages untested)

B1. **`create-avalanche-app`, `@avakit/mcp`, and `@avakit/studio` had zero tests —
   FIXED (re-checked 2026-11-18).** After the two review rounds:
   `create-avalanche-app` has 164 tests in 13 files (argument parsing, the package
   manager runner, the Node.js preflight, scaffolding and its failure path, the
   packed file list, telemetry, the wizard), `@avakit/mcp` has 212 tests in 13
   files (the tool handlers through an in-memory client, the session wallet, the
   faucet client, artifacts, the guards, the registry listing, stdio) and
   `@avakit/studio` has 200 tests in 14 files (argument validation, CB58, devnet,
   Fuji, Interchain, the run manager, the server, its MCP face).
   Studio's test script is now `vitest run`. The other four packages
   (`@avakit/core`, `@avakit/react`, `@avakit/mcp`, `create-avalanche-app`) still
   declare `vitest run --passWithNoTests`, which no longer hides anything but
   would if their tests stopped being found.

B2. **No integration / e2e coverage anywhere** (carried over from item 6) —
   **PARTIALLY FIXED**, see item 6: the agent path is run end to end on Fuji by
   `scripts/e2e-fuji.mjs`; nothing drives a browser.

## C. `@avakit/studio`

C1. **Hardcoded EWOQ private key in source — STILL OPEN** (`DEV_KEY` in
   `packages/studio/src/icm.ts`). It is the well-known public local-devnet key and
   only used against local chains, but it is a literal private key committed to
   the repo and passed on the `cast` command line (`--private-key`, visible in
   process listings). The templates' devnet scripts no longer carry it: they read
   it from avalanche-cli. Studio could do the same.

C2. **`detached: true` orphan processes — STILL OPEN** (`runSteps` in
   `packages/studio/src/steps.ts`): avalanche-cli children are started in their
   own process group so that the local network or the Fuji validator survives a
   Studio restart. Stopping Studio can therefore leave one running with no obvious
   owner. The console's **Cancel** stops the action in progress, not a network it
   already started; Devnet's stop action does that.

C3. **`token` vs `symbol` query-param split was a latent landmine — CLOSED.** The
   L1 native-token symbol once collided with the session-auth `token` query
   parameter and broke the Fuji deploy. Actions no longer travel in a query
   string at all: they start with a JSON `POST /api/run` whose body carries the
   symbol as `symbol` (`startRun` in `server.ts`), so there is nothing left to
   collide with.

C4. **Fuji deploy depends on avalanche-cli's interactive prompt behavior**
   (`fuji.ts:216-222` relies on stdin being closed to auto-skip the "fund
   relayer?" prompt). A CLI update could hang or change the flow.

C5. **Side-effecting GET SSE routes — CLOSED.** `GET /api/devnet/stream` used to
   spawn avalanche-cli from a GET (EventSource can't POST). An action now starts
   only from `POST /api/run`; `GET /api/run/stream` attaches to the log of the run
   that is already going and closing it stops nothing. The dashboard also
   refuses to be framed.
   **Still true:** the session token is the defense, and the event stream takes
   it as a query parameter because EventSource cannot set a header.

C6. **`getFujiKeyBalance` does lossy integer math on wei**
   (`fuji.ts:82`, `Number(wei / 1e12n) / 1e6`) to avoid a bignum dep — truncates;
   display-only, fine for now.

C7. **`messenger-artifact.ts` was a hand-copied build artifact — RESOLVED.** It
   could silently drift from the `icm-messenger` template's Solidity source.
   `contracts-ci/scripts/check-artifacts.mjs` now rebuilds that contract in CI and
   fails unless `MESSENGER_BYTECODE` matches the build and the `*_SIG` constants
   Studio calls the contract with match its ABI; `--write` regenerates the file.

## D. `@avakit/mcp`

D1. **`as never` casts around viem's generics** — brittle if viem's signatures
   change. Re-checked 2026-11-18: `deploy_contract` no longer has one (it encodes
   and signs the transaction itself, `deploy.ts` and `send.ts`). Two remain:
   `read_chain`'s `readContract` call (`server.ts`) and `write_contract`'s
   `simulateContract` call (`write.ts`).

D2. **`estimate_gas` loses precision on large costs** — computes AVAX cost as
   `Number(costWei) / 1e18`; `read_chain`'s balance does the same with
   `Number(wei) / 1e18`. Display-only (the wei value is returned next to it), but
   note it. `wallet_status` uses `formatEther` and is exact.

## E. `@avakit/core` / `@avakit/react` (beyond the 2026-07-04 items)

E1. **`viem` is a devDependency-only in `@avakit/react`.** Works today purely
   because every viem import in react is type-only (erased at build) and runtime
   viem arrives transitively through `@avakit/core`. Adding any runtime viem value
   import to react would silently break consumers who don't independently install
   viem. Make viem a real peer dep, or keep a lint rule forbidding value imports.

E2. **No connection persistence / auto-reconnect** in `AvaKitProvider` — state is
   in-memory only, so a reload drops the wallet. **Still open.**
   **Closed (re-checked 2026-11-18):** the second half of this item. The provider
   now subscribes to the wallet's `accountsChanged`, `chainChanged` and
   `disconnect` events and follows them.

E3. **Data hooks silently dropped pagination — CLOSED.** `useTokenBalances`,
   `useNfts` and `useTxHistory` take `(address?, { pageSize })` and return
   `hasMore`, `fetchMore()`, `isFetchingMore` and `nextPageToken` next to the
   first page (`data-hooks.ts`, tested in `data-hooks.test.tsx`).

E4. **shadcn "style-only" shipping model** (ADR-012): `@avakit/react` emits
   Tailwind token classes and renders unstyled if the consumer hasn't configured
   shadcn tokens — documented but easy to miss.

E5. **`ReadContractParams` (`data.ts`) and `ChainRef` (`data-api.ts`) are not
   exported**, so consumers can't name them.

E6. **No AvaCloud WaaS wallet adapter — still open; the adapter list is corrected.**
   ADR-001 lists WaaS as an opt-in wallet (this item used to cite ADR-004, which is
   about contract tooling) and it was never built. This item also used to say only
   `injected` and `web3auth` exist; today the adapters are `burner` and `injected`
   (main entry), `web3auth` (`@avakit/core/web3auth`) and Coinbase Smart Wallet
   (`@avakit/core/coinbase`). "AvaCloud" still ships solely as the Glacier Data
   API. `CLAUDE.md` no longer names WaaS as an option; `docs/04-adr.md` still does.
   Either build the adapter or drop it there too.

## F. Templates

F1. **`l1-launch` stale references to a non-existent file — FIXED.**
   `templates/l1-launch/lib/l1.ts` and its `CLAUDE.md` pointed at
   `components/explorer.tsx`, but the explorer is inlined in `components/demo.tsx`.
   Nothing in the template refers to `explorer.tsx` any more.

F2. **`eerc-token` demo Mint reverted for most users — FIXED in the UI.** The app
   still points at a *shared* pre-deployed Fuji eERC whose `privateMint` is
   `onlyOwner`, but it no longer offers a button that can only fail: the demo reads
   the instance's owner, disables Mint for everyone else and says why, and
   `npm run deploy:eerc` (`scripts/deploy-eerc.mjs`) deploys an instance of your own,
   which makes you the owner.
   **Still true:** circuits are fetched from a commit-pinned jsDelivr CDN (2–14 MB,
   network-dependent), and `wagmi` is pinned to 2.x, intentionally off the repo's
   "latest stable" rule.

F3. **Cross-chain "in flight" UX is timing-heuristic — PARTIALLY FIXED.**
   `deploy-bridge.mjs` no longer sleeps a fixed 8 s: it polls the home contract
   until the remote is registered, and stops with a clear error after 90 s.
   `icm-messenger` no longer clears its banner when the destination inbox string
   matches: it waits until the destination messenger has counted another
   delivery, so identical text sent twice is handled, and a message that does not
   arrive in time is reported as overdue instead of staying in flight.
   **Still open:** the `token-bridge` UI clears its banner on a hardcoded
   `setTimeout(…, 12000)`.

F4. **Source/artifact duplication — the drift it warned about already happened; a
   CI check now guards against the next one.**
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
   The underlying gap stood then: two copies with no shared source of truth, and
   nothing that fails when a `.sol` and its `lib/*-artifact.ts` disagree.
   **FIXED since:** `contracts-ci/` is that check, and CI runs it (the `contracts`
   job). `scripts/sync.mjs` fails when two templates' copies of a contract differ,
   `forge test` tests the canonical copies, and `scripts/check-artifacts.mjs`
   recompiles each template's contract and fails unless its `lib/*-artifact.ts`
   matches the build.
   **RESOLVED (re-checked 2026-11-18, all three steps run clean on this tree).**
   The check now covers nine artifacts: the five templates' own, the `DemoToken`
   entry of `token-bridge`'s `lib/ictt-artifacts.json`, Studio's messenger
   bytecode (C7), the website's and the example app's. It fails on an artifact
   file nobody listed, `--write` regenerates instead of comparing, and `sync.mjs`
   also fails on a `foundry.toml` whose compiler settings differ from the
   harness's or sit outside `[profile.default]`.
   `contracts-ci/scripts/guards.test.mjs`, which proves the two scripts still catch
   what they are for, runs in the `contracts` CI job.
   **Still open:** the three upstream entries of `ictt-artifacts.json` have no
   source in this repository and are not checked.

F5. **Setup templates need external tooling and only run locally.** `icm-messenger`,
   `l1-launch`, `token-bridge` require `avalanche-cli` and ship
   `*.config.json` as `configured:false` placeholders (a `SetupPanel` blocks the
   app until the one-command script runs). Scripts use `set -uo pipefail` (no `-e`).
   **2026-11-18:** the tool they require, Avalanche CLI, is in maintenance mode;
   each of the three templates' READMEs now carries a "Tooling status" note. See
   "Open on 2026-11-18".

F6. **Bundled Solidity is intentionally minimal (not production).** The ERC-20
   `mint` is a public faucet with no access control, and the NFT's `mint` is open
   to anyone. Fine for demos; flag before anyone copies it to prod.
   **No longer true:** that `AvaKitNFT.sol` "is deliberately not a full ERC-721 (no
   transfer/approve)". The template contract now has the transfer and approval
   surface: `approve`, `setApprovalForAll`, `transferFrom`, both `safeTransferFrom`
   overloads and `supportsInterface`.

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
   **Re-checked 2026-11-18:** `/terminal` and `/avatar` are in the sitemap now
   (`app/sitemap.ts`); `/pitch` is left out of it on purpose.

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
