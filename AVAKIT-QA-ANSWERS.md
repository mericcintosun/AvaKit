# AvaKit QA — Newcomer-DX Feedback + Answers to the 20 Tester Questions

Companion to [AVAKIT-QA-REPORT.md](./AVAKIT-QA-REPORT.md). Same test pass, same environment, published npm releases only.

---

# Part A — Where a developer new to blockchain / Avalanche will get stuck

This is the "I could see past it, a newcomer won't" list. Fully subjective-but-honest DX review, ranked by how likely it is to actually lose a user. None of these are bugs; they're places where the toolkit is *correct* but the newcomer's mental model isn't, and AvaKit doesn't yet bridge that gap.

### A1. Getting Fuji AVAX is the single biggest funnel-killer (minimal, nft-mint, erc20, token-gated, eerc)
The five Fuji templates all dead-end for a newcomer at the same spot: "get test AVAX from the faucet." The Core faucet requires a login and periodically requires a coupon code or a mainnet balance; a brand-new wallet with zero history often can't get funded in one sitting. The templates link the faucet and stop there. A newcomer doesn't know faucets fail, doesn't know alternatives exist, and will conclude *AvaKit* is broken when their first `deploy` button shows an insufficient-funds error.
**Suggestion:** an in-app "you need gas" state that (a) detects zero balance before letting them click deploy, (b) links 2–3 faucet options, (c) explains "~0.1 AVAX is enough for this whole demo." Even better: make the local-devnet path (`l1-launch`) the *recommended first template* in docs, because it's the only one with zero faucet friction — EWOQ is pre-funded.

### A2. "Import the EWOQ key" is a routine step for you, a scary cliff for a newcomer
The devnet templates ask users to import a raw private key into MetaMask. Three problems a newcomer hits in sequence: (1) they don't know *how* (Account menu → Import account — MetaMask hides it well), (2) MetaMask shows a red "imported" badge and warnings that read like they're doing something wrong, (3) they don't understand why one key is "safe to paste" when everything else in crypto screams never-share-your-key. The READMEs do say "public dev key, never use on a real network" — correct but abstract.
**Suggestion:** a 3-screenshot "import the dev key" section in docs, plus one sentence of *why it's safe*: "this key is hardcoded into every local Avalanche network on earth; it holds nothing real." Consider a copy-key button in the app UI itself with that explanation inline.

### A3. Native gas tokens named TOK1/MYL1 break the "gas = AVAX" assumption
On the local L1s, gas is paid in TOK1/TOK2/MYL1 — not AVAX. Every tutorial a newcomer has ever read says "you need AVAX for gas." When MetaMask shows `0 TOK1` (wrong chain selected) or a token symbol they've never heard of, they don't have the schema to debug it. Same trap inside token-bridge: TOK1 is simultaneously *the gas token of chain1* and *the ERC-20 being bridged* — two different balances with the same name on the same screen.
**Suggestion:** rename the bridged demo ERC-20 to something clearly distinct from the chain's native token (e.g. `DEMO`), and add a one-liner in the UI: "gas on this chain is TOK1, not AVAX."

### A4. bytes32 blockchainID vs EVM chainId — handled in code, not yet in the user's head
The icm-messenger README's gotcha note is genuinely good, and `lib/devnet.ts` hides the problem. But the concept resurfaces the moment the user leaves the template: Studio's ICM tools, avalanche-cli output, and any manual Teleporter work all expose both IDs. A newcomer who just saw "Chain ID 1001" in the UI will paste `1001` into anything that asks for a chain ID, including bytes32 fields.
**Suggestion:** docs page "The two chain IDs of Avalanche" (EVM chainId vs P-Chain blockchainID) linked from every ICM/ICTT surface. It's a 10-line explainer that saves an hour of confusion.

### A5. When a transaction fails, viem's raw error is the UX
I hit this myself: the bridge-back revert surfaces as a multi-paragraph viem dump with ABI-encoded revert data. I could decode `ERC20InsufficientAllowance`; a newcomer sees a wall of hex. Same for insufficient gas, wrong chain, user-rejected signature. The hooks (`useSendTransaction`, `useAvaDeploy`) return `error` objects but the templates render them raw (or not at all).
**Suggestion:** a small error-mapper in `@avakit/react` (or even just in the templates): known revert selectors + common viem errors → one-sentence human messages, with the raw error behind a "details" disclosure. This is probably the highest-leverage polish item in the whole toolkit — it upgrades *every* template at once.

### A6. Long-lived background infrastructure is invisible
`pnpm devnet` leaves an avalanchego network + relayer running on the machine, consuming CPU, surviving the terminal. The scripts *do* print stop/clean commands at the end (good), but that text scrolls away; nothing later tells the user "a local Avalanche network is still running." Newcomers will (a) reboot and wonder where their chain went, or (b) never stop it and wonder why the fan is on. My own test pass proved the related failure: leftover state makes the *next* template error out.
**Suggestion:** the devnet templates' UIs already poll chain RPCs — add a footer chip: "local network: running · stop with `avalanche network stop`". Studio partially solves this; cross-link it from every devnet template README.

### A7. Windows is silently unsupported for the best part of the toolkit
`devnet.sh`, `l1.sh`, `bridge.sh` are bash; avalanche-cli targets macOS/Linux. A Windows-without-WSL newcomer — a big slice of hackathon attendees — gets a cryptic `'bash' is not recognized` at the exact moment the toolkit was about to impress them. Nothing in the README or docs says "macOS/Linux or WSL required" for the three devnet templates.
**Suggestion:** one requirements line in those three READMEs + a friendly check at the top of each script. (The pure-Fuji templates work fine on Windows — say that too, it's a selling point.)

### A8. `--chain c-chain` conflates "which chain" with "which network"
Fuji *also has* a C-Chain, so `--chain fuji | c-chain` reads wrong to anyone who knows Avalanche and means nothing to anyone who doesn't ("isn't everything the C-Chain?"). The flag actually selects testnet-vs-mainnet.
**Suggestion:** `--network fuji | mainnet` (keep the old flag as an alias). Also make the scaffolder print a loud "MAINNET — real funds" warning when the mainnet variant is chosen, mirroring the nice guardrail you already have in MCP `deploy_contract`.

### A9. eerc-token's shared instance will produce "it doesn't work" reports
Mint is owner-gated on the shared Fuji deployment — documented in the README, but the in-app experience for a non-owner is a failed transaction, which after A5 means a hex dump. Also 2-decimals amounts and encrypted balances ("why does my balance say hidden?") stack unfamiliarity on the template that is already the most conceptually advanced.
**Suggestion:** in-app callout: "Mint is restricted to the demo-token owner on the shared instance — deploy your own instance to mint (link)." Disable the mint button for non-owners (one `owner()` read) instead of letting it revert.

### A10. The first 30 seconds after `pnpm dev` don't tell you what to *do*
Every template opens on "Connect a wallet to begin" — correct, but a newcomer with no wallet extension installed clicks it and gets… whatever the injected adapter does with nothing to inject. There's no "you'll need MetaMask or Core — install here" empty state, and no social-login option unless a Web3Auth ID is configured, which is itself a dashboard-account-and-whitelist journey (§Q11). The stack's stated mission is "onboarding without the friction," so the no-wallet-at-all case deserves a designed state.
**Suggestion:** detect `window.ethereum === undefined` and render install links; consider shipping a demo Web3Auth client ID for localhost so social login works out-of-the-box on `pnpm dev` (many kits do this with an origin-locked dev ID).

**Meta-observation:** the pattern across A1–A10 is that AvaKit's *happy path is genuinely excellent* and mostly better-engineered than its peers; the gaps are all in the *unhappy paths* (no funds, no wallet, failed tx, dirty state, wrong OS). Newcomers live in the unhappy paths. Budgeting one polish pass purely on failure states would move the needle more than any new feature.

---

# Part B — Answers to the 20 questions

### Environment & setup

**1. Exact environment and package manager per app.**
macOS 26.5.1 (Darwin 25.5.0, Apple Silicon) · Node v24.15.0 · system pnpm **10.20.0** · npm 11.12.1. Nuance: `create-avalanche-app`'s built-in install step ran with its **own bundled pnpm 11.1.3** ("Done in 7.6s using pnpm v11.1.3"), while every command I ran manually afterwards (`pnpm install/typecheck/build/dev`) used system pnpm 10.20.0 — so both major versions were exercised on every template, no issues from the mix. Package manager per app: pnpm for all 8 template apps and both flag variants; `variant-npm` used npm 11.12.1 (created via `--pm npm`, verified `package-lock.json` + working install).

**2. Published packages or local monorepo build?**
Published npm releases **only**, for every finding: `npm create avalanche-app@latest` (0.1.9), `npx -y @avakit/mcp` (0.1.9), `npx -y @avakit/studio` (0.1.6), and `@avakit/core@0.1.2` / `@avakit/react@0.1.3` as installed into the scaffolded apps from the registry. `--local` was never used (noted as untested; it's repo-dev-only per `--help`). No finding in either report comes from source builds.

**3. avalanche-cli / Foundry versions; clean or pre-existing?**
avalanche-cli **1.9.6**, forge/cast **1.7.1** — both already installed. avalanche-cli had **pre-existing state**: a stopped local-network snapshot in which `chain1` was already deployed, plus leftover blockchain configs (`avakitfuji`, `avakitfujil1`, old `chain1`/`chain2`). That dirty state is exactly what surfaced the idempotency bug.

**4. Fresh machine or prior AvaKit state?**
Not fresh. Prior state: the `~/.avalanche-cli` snapshot above, a warm pnpm store (most packages "reused"), a stray `pnpm-lock.yaml` in `$HOME` (amplifies the Next.js workspace-root warning), and an unrelated dev server already occupying port 3000 (all `pnpm dev` checks therefore ran on ports 3100–3107). The test directory itself was empty; every `node_modules` was installed fresh in this pass. No prior AvaKit projects or keys.

### Reproducibility & evidence

**5. Exact commands + verbatim errors + file/line.**

*Failure 1 — devnet not idempotent.* Command: `pnpm devnet` in `icm-messenger-test` (dirty avalanche-cli state). Verbatim:
```
Starting previously deployed and stopped snapshot
...
Network ready to use.

Error: blockchain chain1 has already been deployed
✖ Deploy of 'chain1' failed.
[ELIFECYCLE] Command failed with exit code 1.
```
Location: `scripts/devnet.sh` line 47 (`avalanche blockchain deploy "$CHAIN1" --local </dev/null || die ...`) — the `create` step survives dirty state via `--force`, the `deploy` step doesn't. Identical failure mode reproduced with `pnpm bridge` in `token-bridge-test` while the icm chains were deployed (same names `chain1`/`chain2`, chainIds 1001/1002 — `scripts/bridge.sh` lines 15–16).

*Failure 2 — bridge-back reverts.* Command (replicating exactly the input struct `components/demo.tsx` builds, EWOQ key, local devnet):
```
cast send <remote> "send((bytes32,address,address,address,uint256,uint256,uint256,address),uint256)" \
  "(<chain1_blockchainIdHex>,<home>,<me>,0x0,0,0,250000,0x0)" 1000000000000000000
```
Verbatim:
```
Error: Failed to estimate gas: server returned an error response: error code 3: execution reverted,
data: "0xfb8f41b2...": ERC20InsufficientAllowance(0x17aB05351fC94a1a67Bf3f56DdbB941aE6c63E25, 0, 1000000000000000000 [1e18])
```
Location: `components/demo.tsx` ~lines 124–127 — the approval branch is `if (toRemote) { approve }` only, with the comment "The remote token is burned on send back — no approval," which the deployed `ERC20TokenRemote` contradicts (it pulls via `transferFrom`). Fix verified live: `approve(remote, amount)` on chain2, then the identical `send` succeeded and chain1 balance went 199 → 200 TOK1.

*Failure 3 — Data API helper signature trap (DX, arguably my misuse).* `getNativeBalance(addr, fuji)` (chain object instead of number):
```
Data API request failed (404): {"error":"Not Found","details":"Chain config not found for chain ID: [object Object]"}
```
Works with `getNativeBalance(addr, 43113)`. Signature is `(address, chainId: number)` per the shipped `.d.ts`; docs don't show it.

*Also self-reported:* my first MCP `deploy_contract` call used a wrong param name (`network:` instead of `chain:`); zod silently stripped it and the tool targeted default fuji. Not a failure of the tool per spec, but the non-strict schema behavior is a finding.

**6. Deterministic vs flaky?**
All three deterministic. Devnet failure: reproduced 2/2 given dirty state (icm run 1, bridge collision run); passed 2/2 immediately after `avalanche network stop && avalanche network clean` — so "passed on retry" only in the sense that the retry followed the documented reset. Bridge-back: reverts every time without approval, succeeds every time with it. Nothing flaky observed anywhere in the pass: no TUI hangs, no timeouts, relayer delivery was consistently ~3 s (first poll) in both the ICM and both ICTT directions.

**7. Logs / tx hashes / artifacts.**
Full terminal logs are quoted verbatim in both reports (scaffold output, build output, devnet output, revert data). Key on-chain artifacts from the pass — note the local networks have since been stopped and were wiped between phases, so these are records, not externally verifiable explorers links:
- ICM: messenger `0x52c84043cd9c865236f11d9fc9f56aa003c1f922` on both L1s; `lastMessage() = "hello from QA agent"`, `messagesReceived() = 1` on chain2.
- ICTT (from `bridge.config.json`): demoToken `0x52c8…f922`, home `0x5db9a7629912ebf95876228c24a848de0bfb43a9`, remote `0x17ab05351fc94a1a67bf3f56ddbb941ae6c63e25`, registries `0x5aa0…c70e` / `0x52c8…f922`; balances traced 200 → 199 (+1e18 on remote) → 200 TOK1.
- anvil: AvaKit NFT `0x5fbdb2315678afecb367f032d93f642f64180aa3` (mint OK), ERC-20 AKT `0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0` (mint 100 + transfer OK), access-pass NFT `0x5fc8d32690cc91d4c39d9d3abcbd16989f875707` (mint OK).
No screenshots (headless environment — HTML was probed via curl and text-extracted; extracts are quoted in the report).

### Coverage

**8. Per-template depth table.**

| Template | install | typecheck | build | dev (HTTP 200) | live on-chain action |
|---|---|---|---|---|---|
| minimal | ✅ | ✅ | ✅ | ✅ (:3100) | — (needs funded Fuji wallet) |
| nft-mint | ✅ | ✅ | ✅ | ✅ (:3101) | ✅ bundled artifact: deploy + `mint()` on anvil |
| token-gated-app | ✅ | ✅ | ✅ | ✅ (:3102) | ✅ access-pass artifact: deploy + `mint()` on anvil |
| erc20-token | ✅ | ✅ | ✅ | ✅ (:3103) | ✅ artifact: deploy + `mint()` + `transfer()` on anvil |
| icm-messenger | ✅ | ✅ | ✅ | ✅ (:3105) | ✅ **full E2E on local devnet**: deploy ×2, send, arrival confirmed |
| eerc-token | ✅ | ✅ | ✅ | ✅ (:3104) | ◐ read-only: `name()` on shared Fuji contract; ZK flows untested |
| l1-launch | ✅ | ✅ | ✅ | ✅ (:3106) | ✅ chain live (chainId 9999), demo token deployed via RPC |
| token-bridge | ✅ | ✅ | ✅ | ✅ (:3107) | ✅ mint/approve/bridge-out; ❌ bridge-back (bug) → ✅ with fix |

“On anvil” = the template's bundled bytecode/ABI proven on a local Foundry chain; the browser-wallet click path itself wasn't driven (no browser wallet available — see Q9).

**9. Networks / wallets / funding / hashes for on-chain runs.**
Networks: avalanche-cli local devnets (chain1/chain2 for ICM and ICTT, mychain for l1-launch) + a plain anvil chain for artifact validation. **No browser wallet was used at all** — the environment is headless, so every "user action" was replicated at the RPC layer with `cast`, signing with the pre-funded EWOQ key on local chains and anvil's default dev key locally. No real Fuji transactions were sent (no funded Fuji key). Addresses in Q7; tx hashes weren't retained beyond status checks and the local chains are gone, which I flagged in the report as "records, not receipts."

**10. pnpm build gates.**
Never hit, on any template, on either pnpm version. `sharp` and `protobufjs` postinstalls executed during scaffold ("sharp install: Done"), and `pnpm ignored-builds` on pnpm 10.20 reports "Automatically ignored builds during installation: None." Cause: the shipped `pnpm-workspace.yaml` pre-approves them (`allowBuilds: sharp/protobufjs/tiny-secp256k1`) and exempts `@avakit/*` from the release-age gate (`minimumReleaseAgeExclude`) — notable because 0.1.9 was published *the same day* I installed it and nothing was blocked. Caveat for completeness: I did not run a control test with that file deleted, so "the gate would have fired without it" is inferred, not proven.

**11. Web3Auth social login.**
Untested — no `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (and no browser to complete OAuth anyway). What I did verify around it: without a client ID the adapter list correctly contains only `injectedAdapter` (the conditional in `providers.tsx`); the `--wallet injected` variant builds even *with* a client ID set despite `@web3auth/modal` being absent, because `@avakit/core/web3auth` dynamic-imports the modal inside try/catch and degrades to `WalletNotAvailableError("web3auth")`. Google sign-in → embedded wallet → Fuji switch is a genuine coverage hole in this pass; it needs a human with a dashboard project.

**12. eerc-token.**
Register/mint/transfer/burn were **not** exercised — they require in-browser ZK proof generation with a connected, Fuji-funded wallet. No `InvalidProof` data therefore. What was verified: all **10** pinned circuit files (register/mint/transfer/withdraw/burn × wasm/zkey) at jsDelivr commit `c7eb0e09…` return HTTP 200; the shared Fuji instance `0xfB27…d58` has code and `name()` returns `"Test"`, matching the config comment (owner-gated mint as documented).

**13. Local-devnet scripts.**
All three ran **to completion** on a clean network: `pnpm devnet` (icm), `pnpm l1`, `pnpm bridge` — each wrote its config JSON with correct RPCs/blockchain IDs, and `pnpm l1` even succeeded *while* the ICM chains were still running (added mychain to the live network). Zero interactive-TUI hangs — the scripts' `</dev/null` + `--test-defaults`/`--sovereign=false` flags do their job in a non-TTY. No "max code size exceeded." Relayer worked in all three flows. The **only** failure mode is dirty pre-existing state (Q5-failure-1), plus the chain1/chain2 name collision making icm-messenger and token-bridge mutually exclusive until a `network clean`.

**14. Studio.**
Ran `npx @avakit/studio` → dashboard on a random port (`http://127.0.0.1:57367/`). Important nuance: I walked every view **at the API layer** with curl rather than clicking in a browser. The initial 401s I got were the session-token auth *working as designed* (token is injected into `index.html` as `window.__AVAKIT_STUDIO__`; extracting it and sending `x-studio-token` made everything pass) — not a bug. Verified: `/api/health`, `/api/env` (correct tool detection), `/api/devnet/status` (accurate running/deployed flags incl. stale configs), `/api/icm/state` (live bridge chains with messenger addresses), `/api/data` (real Fuji balances/tokens), `/api/fuji/key` + `/api/fuji/balance` (sensible empty states — no key stored). **Not completed:** the Fuji wizard's create-key → fund → C→P → deploy sequence (needs 1–2 real AVAX) and pressing devnet spin-up from Studio itself (would have destroyed the in-progress bridge test; the underlying avalanche-cli flow is the same one proven via the templates). MCP mode: yes — `npx @avakit/studio mcp` initialized (`avakit-studio 0.1.6`) and listed all 10 tools; devnet-mutating tools deliberately not invoked, `icm_state`-equivalent data verified via the HTTP API instead.

**15. @avakit/mcp client + tools.**
Client: none of the three — I drove the server over **raw stdio JSON-RPC** (Python harness doing `initialize` → `notifications/initialized` → `tools/list` → `tools/call`), which verifies protocol conformance but not client-config integration (the README's Claude Code/Cursor JSON snippet itself was not installed into a client). All 5 tools exercised, **all passed**: `list_templates` (8 templates + contracts flags), `scaffold_app` (16 files; correctly refuses non-empty dirs), `read_chain` (balance ✅, contractRead ✅ `name()="Test"`, invalid action → clean zod error; `txReceipt` only smoke-tested via validation), `get_context` (accurate surface), `deploy_contract` (mainnet refusal verbatim: *"Refusing to deploy to Avalanche C-Chain (mainnet) without confirm:true."*; fuji attempt with throwaway key surfaced viem's insufficient-funds correctly). One finding: schemas aren't `.strict()` — unknown keys are silently dropped (my `network:"mainnet"` typo quietly became a default-fuji deploy attempt).

### Website & docs

**16. apps/web.**
Partially covered, honestly thin: I reviewed **EN desktop content** (`/`, `/docs`, `/docs/core`, `/docs/react`, `/templates`) and confirmed `/tr` exists with a complete-looking Turkish translation. Not tested: mobile layouts, dark/light rendering, browser-console errors, the feedback button, the recommender/decision-tree interactivity, or link-by-link 404 sweeping — text-level fetching only, no real browser. One item worth checking on your side: the landing page's templates section read as showcasing **six** templates while the toolkit ships **eight** — possibly intentional curation, possibly a stale count (unconfirmed, flagged as suspected).

**17. Docs commands copy-paste.**
Yes for the core path: the quickstart (`npm create avalanche-app@latest` → `pnpm install` → `pnpm dev`), every per-template scaffold command, and the README install snippets all worked exactly as written. Mismatches found: (a) templates-page requirement chips imply Foundry is needed for templates that ship bundled bytecode — it isn't at runtime, only for editing contracts (token-bridge's own README gets this right); (b) quickstart's unconditional `cp .env.example .env.local` is meaningless for `--wallet injected` scaffolds; (c) `/docs/core` omits the Data API helpers' `chainId: number` signatures (the `[object Object]` 404 trap); (d) the scaffolder's printed next-steps omit `pnpm devnet`/`l1`/`bridge` for the three devnet templates — CLI output rather than docs, but it's the "documentation" people actually follow. MCP config JSON was validated structurally (same command/args I ran) but not installed into a client (Q15).

### Triage

**18. Severity ranking + first fix.**
Blockers: none (nothing prevents install/build/run everywhere).
**Major:** ① token-bridge bridge-back revert — a shipped, deterministic, user-facing E2E failure in the template's headline flow; **fix this first** (smallest diff, worst impression: "the bridge template can't bridge back"). ② devnet scripts non-idempotent + cross-template chain1/chain2 collision — first-command failure on any machine with old state, unclear recovery.
**Minor:** ③ scaffolder next-steps omit the devnet step; ④ MCP non-strict schemas (silent unknown-param drop on a deploy tool — small fix, outsized safety value for AI callers); ⑤ Data API signature inconsistency/undocumented.
**Cosmetic:** ⑥ Next.js workspace-root warning on every build; ⑦ `.env.example` + Web3Auth copy shipped in injected-only scaffolds; ⑧ possible stale six-vs-eight template count on the landing page.

**19. What worked well / surprising; suspected but unconfirmed.**
Genuinely impressive: 8/8 templates clean on install+typecheck+build+dev; the `pnpm-workspace.yaml` pre-empting both pnpm-10 build gates *and* the release-age gate (same-day 0.1.9 installed frictionlessly — someone thought ahead); relayer delivery consistently ~3 s; docs↔published-API match is literally 1:1 (rare at pre-1.0); Studio's token+host-allowlist auth on a localhost tool; MCP's mainnet guardrail actually working; graceful dynamic-import fallback in the web3auth adapter; `pnpm l1` coexisting with an already-running network.
Suspected, couldn't confirm: (a) icm-messenger UI showed both chains "offline" in SSR HTML while the RPCs were demonstrably up — probably a client-side health poll I couldn't observe without a browser; worth one manual look; (b) whether Web3Auth login actually completes end-to-end (untestable here, and it's the *default* wallet mode of every template — biggest blind spot of this pass); (c) eerc non-owner mint UX — likely a raw revert, unverified; (d) the six-templates landing count (Q16); (e) whether the release-age gate would really block `@avakit/*` without the exclude (no control test).

**20. Environment-specific findings.**
(a) The devnet "already been deployed" failure **requires** pre-existing avalanche-cli state — a truly fresh machine won't hit it on run #1; but it's not exotic: anyone re-running after a reboot-interrupted session, or trying icm-messenger *and* token-bridge, lands in it, which is why I kept it Major. (b) Port 3000 being occupied was my machine's quirk; everything worked on alternate ports — but note templates hardcode "http://localhost:3000" in READMEs/UI copy while `next dev` may auto-shift ports. (c) The Next.js workspace-root warning is amplified by a stray `$HOME/pnpm-lock.yaml` here, though the app-level `pnpm-workspace.yaml` should trigger a variant of it on clean machines too — verify before prioritizing. (d) Node 24 (well above the ≥20.11 floor) and warm pnpm store — floor-version installs and cold-cache timings untested. (e) Headless testing means all "browser wallet" conclusions come from RPC-level replication of the exact call the UI makes — high confidence for contract logic (the bridge bug repro'd from the app's own input struct), zero coverage of wallet-popup UX itself.
