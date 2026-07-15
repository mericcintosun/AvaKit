# AvaKit — Execution Plan (Vision · Decisions · Technical & Marketing Roadmap)

> **Status:** execution plan, 2026-07-15. Turns
> [`independence-and-ecosystem-strategy.md`](./independence-and-ecosystem-strategy.md)
> into concrete, owned, sequenced work — locked decisions, package-by-package
> technical steps (with file refs), the new vision, brand-visibility plan,
> marketing moves, and a standalone **Month-2 marketing plan**. Checkboxes are the
> live to-do list; keep them updated.
>
> Priority key: **P0** = do first / unblocks everything · **P1** = core of the
> rebuild · **P2** = follows. Effort: **S** ≤1d · **M** ≤1wk · **L** >1wk.

---

## 1. The new AvaKit vision

**Old positioning:** *"The open-source, AI-native developer toolkit for Avalanche."*
(Accurate, but developer-only and it undersells the barrier we're removing.)

**New positioning:**

> **AvaKit — go from zero to a live Avalanche app in 60 seconds. In your browser.
> No install, no signup, no seed phrase, no gas.**
> The open-source, AI-native front door to Avalanche.

**The promise, three layers (each a headline we can defend):**
1. **Zero-barrier:** a stranger tries a real Fuji deploy+mint in the browser, no setup.
2. **AI-native:** ask Claude Code / Cursor to build on Avalanche → AvaKit does it (action-MCP).
3. **Production-ready:** the same app scaffolds locally and ships, wrapping the real Avalanche stack (AvaCloud, the SDK, ICM, eERC).

**What changes vs. today (messaging shift):**

| Today's emphasis | New emphasis |
|---|---|
| "deploy from the browser" (dev feature) | **"try it now, zero setup"** (anyone, 60s) |
| "social login with Google" (needs a client ID) | **"a wallet appears, gasless first tx"** (burner/passkey + hosted faucet) |
| "8 templates" | "8 templates **you can run in the browser right now**" |
| "a toolkit" | "**the front door to Avalanche** — wraps the official stack" |
| implicit: for people already set up | explicit: **for someone who has never touched Avalanche** |

**Positioning vs. official SDK (do not attack it):** *"We wrap the Avalanche stack
and make it 60-second-usable. Every AvaKit user is an Avalanche/AvaCloud user who
onboarded in a minute instead of an afternoon."*

---

## 2. Decisions locked

The commitments this plan is built on. (Owner can veto any row — flagged ones in §7.)

| # | Decision | Rationale | Implication |
|---|---|---|---|
| D1 | **Offer both wallets, explained simply; burner is front-and-center.** On load: "do you have a wallet?" → connect it (Core/MetaMask/passkey) if yes, **auto-create a burner if not.** Web3Auth/MetaMask Embedded stays available, no client-ID wall on first run. | No social provider is truly zero-config; the client-ID wall is our #1 barrier (U1). Owner: keep choice but make burner the no-friction default. | New burner + passkey adapters in `@avakit/core`; a simple wallet-chooser UX in templates; social login needs no key to *try*. |
| D2 | **AvaKit operates a hosted Fuji faucet drip** (self-hosted `ava-labs/avalanche-faucet`, our key, rate-limited). | Only path to a real auto-fund API; kills U2. | New tiny service + `useFaucet`; server-side key + abuse controls. |
| D3 | **Gasless via AvaKit-hosted paymaster** (Pimlico/Biconomy on Fuji/C-Chain), opt-in Tier-2. | Removes the gas mental model; generalizes to mainnet. | Paymaster config in `@avakit/react`; ERC-4337 default (7702 = verify later). |
| D4 | **No-compiler UI deploy is the default** for all contract templates; Foundry demoted to opt-in "customize." | We already ship bytecode; kills U3. | Deploy from dapp UI via viem; OZ-Wizard/Remix hand-off for edits. |
| D5 | **Wrap the official stack**, don't compete. `@avakit/core` = stable viem facade; AvaCloud = default zero-infra backend; wallet-agnostic (Core, WaaS). | Official stack is fragmented/beta/no-scaffolder. | AvaCloud auto-wire; new Core + WaaS adapters. |
| D6 | **Action-MCP is the moat.** List on all registries; keep it action-capable. | Official MCP is docs-only. | Publish `@avakit/mcp`; tool descriptions self-recommend. |
| D7 | **Build AvaKit Cloud end-to-end** (hosted faucet + paymaster + RPC + sandbox + dashboard), **operated at $0 out-of-pocket** — free tiers + grant-funded. OSS core never gated; everything self-hostable. | Owner: "it's open source; if it doesn't cost me money, let's build AvaKit Cloud fully." | Cost-engineer to zero (Pimlico testnet-free, public/AvaCloud-free RPC, free hosting); gate anything with real cost (mainnet gas, high volume) until a grant funds it. |
| D8 | **Instrument everything** (opt-out CLI telemetry + public `/stats`). | Grants/DevRel/Retro9000 need proof. | Telemetry in the CLI; stats page on the site. |
| D9 | **Brand gets a face + a louder presence.** Finish the AvaFox / Obsidian Core mascots; consistent 🔺 crimson; motion-forward site. | Early-stage visibility needs a memorable brand, not just a logo. | Commit/ship the `avatar` + `public/3d` WIP; brand kit. |

---

## 3. Technical execution (software)

Nine workstreams. Each task tagged `[P· / effort]` with the file(s) it touches.
This is the full buildable surface — sequence in §6.

### W1 — Zero-config wallet + funding *(D1, D2, D3)* — the highest-ROI workstream
- [x] `[P0/M]` **Burner adapter** — `packages/core/src/adapters/burner.ts`: viem
  `generatePrivateKey`/`privateKeyToAccount`, persisted to `localStorage`,
  implements `WalletAdapter`. Exported from `adapters/index.ts` + the core barrel,
  with `burner.test.ts`. Shipped in 0.2.0.
- [x] `[P0/S]` **Fund the burner on connect** — `@avakit/react` `useFaucet` hook +
  provider option `faucetUrl`. *Deviation:* `provider.tsx` drips on every burner
  connect rather than only when the balance is 0 — the faucet's 24h per-address cap
  absorbs it, but the balance check is still worth adding.
- [x] `[P0/L]` **AvaKit faucet service** — `services/faucet/`, live at
  `avakit-faucet.avakit.workers.dev`. *Differs from plan:* it's an original
  Cloudflare Worker, not a wrap of `ava-labs/avalanche-faucet`. Key server-side,
  Fuji-only allowlist, per-address 24h + per-IP 20/hr caps. **Captcha still missing**
  (see W8).
- [x] `[P1/M]` **Coinbase Smart Wallet adapter** — shipped at
  `packages/core/src/coinbase.ts` (not `adapters/`), behind the `@avakit/core/coinbase`
  subpath, `@coinbase/wallet-sdk` an optional peer, with `coinbase.test.ts`.
- [ ] `[P1/L]` **Paymaster / gasless path** — Tier-2 opt-in; `@avakit/react`
  provider `sponsorGas?: boolean` + `paymasterUrl`; wire Pimlico/Biconomy on
  Fuji/C-Chain; sponsor the first UserOp. Touches `hooks.ts`
  (`useContract.write`, `useAvaDeploy`, `useSendTransaction`).
- [x] `[P0/M]` **Wallet-chooser UX (D1)** — `packages/react/src/connect-avalanche.tsx`
  splits the burner out ("Start instantly with a temporary wallet") from the
  bring-your-own wallets; all 8 templates wire burner + injected + web3auth in
  `app/providers.tsx`.
- [ ] `[P1/S]` **`--wallet` is now vestigial** — templates register all three adapters
  regardless of the flag, so `--wallet` no longer selects a wallet. Either make it
  prune adapters from `providers.tsx`, or drop it. (Its one real effect — gating the
  `@web3auth/modal` install — shipped a Social-login button that threw on click; that
  is fixed by always installing the SDK, which leaves the flag doing nothing.)
- [ ] `[P2/S]` **AvaCloud WaaS adapter** — `packages/core/src/waas.ts` subpath
  (closes KNOWN-GAPS E6); seedless/HSM, opt-in.

### W2 — No-compiler deploy + template correctness *(D4, KNOWN-GAPS F)*
- [ ] `[P1/M]` **UI-deploy is the documented default** — every contract template's
  `components/demo.tsx` deploys the bundled `{abi,bytecode}` via viem from the
  connected wallet (nft-mint/token-gated/erc20/l1-launch already do; standardize +
  document "no Foundry needed"). Foundry = opt-in "customize" path in CLAUDE.md.
- [ ] `[P1/S]` **OZ-Wizard → Remix hand-off** — a "customize this contract" link in
  contract templates instead of implying a local Foundry edit loop.
- [ ] `[P1/M]` **Fix eERC (U5/F2)** — `packages/create-avalanche-app/templates/eerc-token`: scaffold a
  *user-owned* eERC instance (mint works out of the box) or an open-mint demo
  instance; vendor circuits locally or first-party CDN.
- [x] `[P1/S]` **l1-launch stale ref (F1)** — fixed in `lib/l1.ts`. (The `CLAUDE.md`
  half of this item was never real: it already named `components/demo.tsx` correctly.)
- [ ] `[P2/S]` **De-duplicate contracts (F4)** — shared source for `AvaKitNFT.sol` /
  `AvaKitToken.sol` (or accept + document the intentional copies).

### W3 — Hosted / managed paths (remove local toolchain) *(Pillar 2)*
- [ ] `[P1/M]` **`devcontainer.json` + "Open in Codespaces"** in every template —
  cloud toolchain for anyone who wants avalanche-cli + Foundry, zero local install.
- [ ] `[P1/S]` **"Open in StackBlitz / CodeSandbox" + "Deploy to Vercel"** buttons
  in every template README (frontend only — note WebContainers can't run native
  binaries).
- [ ] `[P2/L]` **AvaCloud-hosted L1 path for `l1-launch`** — guided "Create an L1"
  flow (Fuji free starter) as an alternative to the local avalanche-cli script;
  UI reads the returned RPC/explorer.
- [ ] `[P2/L]` **AvaCloud hosted relayer for `icm-messenger`/`token-bridge`** —
  two L1s with the Teleporter checkbox on; the local relayer step disappears.
  *(Blocked on AvaCloud API access — §7 partner ask.)*

### W4 — Wrap the official stack *(D5)*
- [ ] `[P1/M]` **AvaCloud Data API auto-wire** — scaffolder provisions/reads
  Glacier RPC + Data API keys; `@avakit/react` data hooks already exist
  (`useTokenBalances/useNfts/useTxHistory`) — make them the default read path.
- [ ] `[P1/M]` **First-class Core adapter** — injected/WalletConnect, **P-Chain
  aware** for L1/validator flows.
- [ ] `[P2/M]` **`@avakit/core` as facade over `@avalanche-sdk/*`** — expose
  P-Chain/interchain power behind our stable surface; absorb their beta churn.
- [ ] `[P2/S]` **Export `ReadContractParams` + `ChainRef`; add pagination** to the
  data hooks (KNOWN-GAPS E3/E5).

### W5 — Action-MCP + registries *(D6)*
- [x] `[P0/S]` **Publish `@avakit/mcp`** to the official MCP Registry — **live as
  `dev.avakit/avalanche`**, and it now shows up alongside the docs-only competitor for
  `search=avalanche`. `awesome-mcp-servers` PR open (#10168). Smithery/mcp.so/Glama
  need an account — `smithery.yaml` is committed and ready; see
  `packages/mcp/REGISTRIES.md` for the process, the gotchas, and where the key lives.
- [ ] `[P1/S]` **Derive `AVAKIT_DEP_VERSION` (KNOWN-GAPS A2)** — it's hand-maintained
  in `packages/create-avalanche-app/src/api.ts` and must stay **at or below the lowest**
  of the published `@avakit/core` / `@avakit/react` versions, or every scaffold fails
  at `pnpm install`. Derive it at build time (tsup `define`) from those package.jsons,
  or give core and react their own placeholders so neither has to be held back.
  *(A1 — "pass `avakitVersion` from the MCP" — is closed: `scaffoldApp` already
  defaults to the shared constant, so passing it would be a no-op.)*
- [ ] `[P1/M]` **New MCP tools** — `faucet` (drip to address), `launch_l1`,
  `send_icm`; tool descriptions self-recommend `create-avalanche-app`.
- [ ] `[P2/M]` **Optionally proxy the official docs MCP** (`build.avax.network/api/mcp`)
  → "docs + actions" in one server.

### W6 — Website "try it now" + proof *(Pillar 5, D8)*
- [x] `[P0/L]` **`avakit.dev/new` live in-browser demo** — real Fuji deploy→mint
  running on the landing page (burner + public RPC + AvaKit faucet + demo
  contract). This is the "try it now" moment. New route under `apps/web/app/[locale]/`.
- [x] `[P0/M]` **Opt-out anonymous CLI telemetry** — `packages/create-avalanche-app`:
  count scaffolds, template, chain, success/fail (Next.js model, documented,
  privacy-safe). Client in `src/telemetry.ts`; collector in `services/telemetry/`
  (a SQLite Durable Object — KV's 1 write/sec/key ceiling and read-modify-write
  races made it the wrong store for a number we publish). Off in CI, so our own
  smoke tests can't inflate it.
- [x] `[P1/M]` **`avakit.dev/stats`** — downloads + scaffolds + apps shipped + MCP
  calls. Public metric = distribution asset + grant artifact. *(Shipped with npm
  downloads + GitHub stars + scaffolds/installs; MCP calls still pending a
  server-side counter.)*
- [ ] `[P1/S]` **Site + README copy → new vision** (§4). Fix "four vs five surfaces"
  (KNOWN-GAPS G4).
- [ ] `[P2/S]` **Resolve next-intl vestigial layer (G1)** — either populate
  `messages/*.json` or remove the unused next-intl wiring.

### W7 — Brand *(D9)*
- [ ] `[P1/M]` **Put the mascots to work** — the "untracked" and "CDN `<model-viewer>`"
  premises are both stale: `apps/web/app/[locale]/avatar/` and `public/3d/` are tracked,
  and `@google/model-viewer` is an npm dep, dynamically imported. What's actually left:
  they appear nowhere except a footer link — no nav entry, and **no mascot on `/new`**,
  the one page strangers land on.
- [ ] `[P2/S]` **Brand kit** — 🔺 crimson tokens (already in `globals.css`),
  mascot art, social templates, consistent OG images.

### W8 — Security / infra hardening for the hosted layer *(D7)*
- [ ] `[P0/S]` **Faucet/paymaster abuse controls** — captcha, per-IP + per-address
  caps, low drip, circuit-breaker, alerting. Keys server-side only.
- [ ] `[P1/S]` **Rotate the exposed Typefully key** (from launch work) + audit any
  other exposed secrets before standing up new services.

### W9 — Tests for the newly-critical paths *(KNOWN-GAPS B)*
- [ ] `[P1/M]` **Faucet + paymaster + burner** unit/integration tests (these are
  now user-facing critical paths).
- [ ] `[P2/M]` **First e2e** — headless connect→deploy→mint on Fuji (proves the
  60-second promise doesn't regress).

**New infra components (architecture summary):**
- **Faucet service** — Node, wraps `ava-labs/avalanche-faucet`, one Fuji key,
  `POST /fund`, abuse-gated. Hosted by AvaKit. Swappable for user's own.
- **Paymaster** — Pimlico/Biconomy verifying paymaster, AvaKit-funded on Fuji,
  opt-in on C-Chain. Swappable.
- **Sandbox seeding** — StackBlitz/Codespaces templates pre-seeded with Tier-1
  defaults so "Open in…" boots a working dapp.

---

## 4. Marketing & brand execution

### 4a. Brand visibility (D9)
- **Give AvaKit a face:** ship AvaFox + Obsidian Core as recurring brand
  characters (site, social avatars, template loaders, sticker-worthy). Early-stage
  recognition comes from a character + a color + a repeated phrase.
- **One repeated phrase:** *"zero to a live Avalanche app in 60 seconds."* Put it
  everywhere (README, site hero, every thread, talk titles).
- **One color, one triangle:** 🔺 Ember Crimson, consistently. OG images + social
  templates from a single brand kit.
- **Show, don't tell:** the live `/new` demo *is* the marketing — every post links
  to a thing that runs, not a screenshot.

### 4b. Content to revise (content will change — this is the list)
- [ ] **README hero** — lead with the 60-second/zero-setup promise + a "Try it now"
  button (once `/new` is live), not "deploy from the browser."
- [ ] **Site hero + landing sections** (`apps/web` `components/landing/*`) — reframe
  around zero-barrier + "try it now" + AI-native front door.
- [ ] **Content calendar** (`docs/launch/content-calendar.md`) — Month-1 posts
  (7 Jul–4 Aug, already scheduled in Typefully) over-index on "deploy from the
  browser / social login." **Keep them running** (they're live), but **Month 2 pivots**
  to the new vision (see §5). Optionally swap the later Month-1 posts to tease
  "try it now" if `/new` ships early.
- [ ] **Launch kit** (`docs/launch/launch-kit.md`) — update the one-liner + the PH
  tagline to the new positioning for any future re-submission.

### 4c. Distribution moves (self-serve, do now)
- [ ] **Builder Hub Integrations PR** — `ava-labs/builders-hub`,
  `content/integrations`, "Developer Tooling." Highest-leverage official listing.
- [ ] **Core ecosystem directory** — submit via `core.app/discover` /
  `projectdirectory@avalabs.org`.
- [ ] **MCP registries** — official Registry + Smithery + mcp.so + Glama +
  awesome-mcp-servers (also a W5 task).
- [ ] **awesome-avalanche** PRs (arminreiter + forks).
- [ ] **Recruit 1–2 credible Avalanche voices** (Team1 members, Academy
  instructors) to try `/new` and endorse.

### 4d. Grants pipeline (funnel, not lottery)
- [ ] **Team1 Builder Grants** (Mini ≤$10k / Accelerator ≤$30k) — fast first check.
  Pitch: the missing scaffolder + zero-barrier onboarding for Avalanche.
- [ ] **infraBUIDL(AI)** (~$15M program) — pitch `@avakit/mcp` as intelligent
  tooling that drives developer adoption. Best thematic fit.
- [ ] **Retro9000** ($40M, retroactive, no application) — instrument public metrics
  (W6) so scaffolds/apps-shipped are votable each quarterly snapshot.
- [ ] **Codebase Season 4** ($50k non-dilutive) — network/legitimacy halo.

### 4e. DevRel / partnership asks (needs Foundation/Team1)
- [ ] Pitch `create-avalanche-app` as the **Academy / Builder Hub quickstart**
  ("your toolkit names no scaffolder — we fill it, wrapping your stack").
- [ ] **Default stack + bounty at the next Team1 / Summit hackathon.**
- [ ] **AvaCloud API access** for headless L1 + hosted relayer (unblocks W3).
- [ ] **Faucet allowance** / blessing to run our small Fuji drip.

---

## 5. Month-2 marketing plan (≈ 5 Aug → 5 Sep)

**Context:** Month-1 is the 15-post launch calendar, live in Typefully, running
**7 Jul → 4 Aug**, every 2 days, in the established voice (lowercase, human, 🔺, no
em-dash — see `docs/launch/content-calendar.md`). Month 2 is the **"rebuild &
relaunch" arc**: the story becomes *"we heard the feedback, we killed the barriers,
now anyone can try it in 60 seconds."* Same voice.

**Theme of the month:** **zero-barrier + build-in-public on the rebuild.** Every
post ladders to one of: *try it now* · *we removed a barrier* · *AI builds on
Avalanche* · *proof/metrics* · *ecosystem*.

**Cadence:** every 2 days (~15 posts), plus **2 anchor beats**: the **`/new` "try it
now" relaunch thread** and a **grant/partnership announcement** when they land.
Front-load the relaunch.

**Channels:** X (primary, via Typefully), a dev.to "how we rebuilt onboarding"
long-form, Reddit r/Avax for the relaunch, Avalanche Discord dev channels, and the
Builder Hub listing going live.

**Month-2 post concepts (draft hooks — new vision, same voice):**
1. **relaunch / anchor** — "we rebuilt the whole onboarding. try a live avalanche mint in your browser, right now. no wallet, no signup, no gas. avakit.dev/new 🔺"
2. **build-in-public** — "the feedback that changed avakit: 'it's too dependent, a new user can't just dive in.' so we killed every setup step. thread 👇"
3. **barrier killed: wallet** — "you don't need a web3auth key anymore. a wallet just appears in the browser. social login is now an optional upgrade, not a wall."
4. **barrier killed: gas/faucet** — "no more hunting for a faucet. your first transaction on fuji is funded and gasless. you just click mint."
5. **barrier killed: toolchain** — "no foundry, no avalanche-cli to start. deploy a real contract from the browser. want to run the full toolchain? one click into a codespace."
6. **AI-native** — "ask claude code: 'build me an avalanche nft app and deploy it.' the avakit mcp actually does it. the official avalanche mcp only reads docs 🔺" (tactful, factual)
7. **try-it template** — a short clip of "open in stackblitz" booting a working avalanche dapp in ~10 seconds.
8. **proof/metrics** — "since launch: X scaffolds, Y apps shipped on avalanche via avakit. live at avakit.dev/stats." (once telemetry ships)
9. **wrap-not-replace** — "avakit isn't a new avalanche sdk. it's the 60-second front door to the real one. every avakit user is an avalanche user who onboarded in a minute."
10. **mascot / brand** — introduce AvaFox + Obsidian Core; "meet the avakit crew 🔺" (light, shareable).
11. **gasless deep-dive** — one code block: `sponsorGas: true`. "that's the whole gasless setup on avalanche."
12. **ecosystem** — "avakit is now in the avalanche builder hub integrations directory. building on avalanche should start with one command."
13. **template spotlight** — the eerc / confidential-token template, now working out of the box in the browser.
14. **grant/partnership anchor** (when it lands) — announce Team1/infraBUIDL support; thank the ecosystem.
15. **month wrap / vision** — "month one: we shipped. month two: we made it something a stranger can use in a minute. next: the default way to build on avalanche 🔺"

**Rules:** keep the voice guide; every post links to something that *runs*
(`/new`, a template sandbox, `/stats`); reply to every comment in the first hour;
front-load the strongest (1, 2, 4, 6) in week one of the month.

---

## 6. Sequenced timeline (technical + marketing merged)

**Weeks 1–2 (now → ~29 Jul) — kill the barriers, self-serve moves:**
- Tech: W1 burner adapter + `useFaucet` + **faucet service** (P0); W5 publish MCP +
  fix pin; W6 CLI telemetry; W2 eERC + l1-launch fixes; W8 abuse controls + rotate
  keys.
- Mktg: Builder Hub PR; Core directory; MCP registries; awesome-avalanche PRs;
  start Team1 + infraBUIDL(AI) applications.

**Weeks 3–4 (~30 Jul → 12 Aug) — the "try it now" relaunch:**
- Tech: W6 `avakit.dev/new` live demo (P0); W1 Coinbase adapter + Tier-2 paymaster;
  W3 devcontainer + StackBlitz buttons; W6 `/stats`; W1/W2 site+README copy.
- Mktg: **Month-2 relaunch thread (post 1/2)**; dev.to "how we rebuilt onboarding";
  r/Avax relaunch; brand/mascots (W7) live on `/new`.

**Weeks 5–8 (Aug) — wrap the stack + prove it:**
- Tech: W4 AvaCloud Data API auto-wire + Core adapter; W4 SDK facade start; W3
  AvaCloud L1/relayer (pending API); W9 first e2e.
- Mktg: metrics posts; ecosystem + partnership beats; hackathon default-stack push;
  Retro9000 visibility.

**Months 3–6 — "surpass the SDK":**
- Tech: full `@avakit/core` facade; broaden action-MCP (faucet/L1/ICM); optional
  light "AvaKit Cloud" tier.
- Mktg: docs-default DevRel; SpeedRun Avalanche + template gallery; Codebase.

---

## 7. Decisions resolved (owner, 2026-07-15)

1. **Hosted infra → AvaKit Cloud (D2/D3/D7):** ✅ **Build AvaKit Cloud end-to-end**,
   operated at **$0 out-of-pocket** — free tiers (Pimlico testnet-free paymaster,
   public/AvaCloud-free RPC, self-hosted faucet on free hosting) + grant funding.
   OSS core never gated; everything self-hostable. Real-cost pieces (mainnet gas
   sponsorship, high-volume RPC) stay gated/deferred until grant-funded.
2. **Default wallet (D1):** ✅ **Offer both, explained simply.** Burner
   front-and-center; ask "do you have a wallet?" → connect Core/MetaMask/passkey if
   yes, **auto-burner if not.** No client-ID wall on first run.
3. **Brand / mascots (D9):** ✅ **Finish + ship now** — AvaFox + Obsidian Core
   become the AvaKit brand face (site, `/new`, docs, social).
4. **Month-1 content:** ✅ **Do not touch** the 15 live scheduled posts. Produce a
   **v2 calendar for after 4 Aug** → [`../launch/content-calendar-v2.md`](../launch/content-calendar-v2.md).

**Still open (later):** exact AvaKit Cloud hosting choice (Cloudflare Workers /
Vercel / Railway free tiers), and whether a mainnet gasless tier is pursued only
after a grant lands.

> **A note on "$0 out-of-pocket" (honest cost reality):** at demo / early scale
> this is achievable — Pimlico sponsors testnet gas free, public & AvaCloud-free
> RPC cover reads, and the faucet server fits a free hosting tier. The one true
> variable is **Fuji AVAX to fund the faucet key** (the official faucet is
> mainnet-AVAX-gated) and **any mainnet gas sponsorship** — both are small and are
> exactly what a Team1 / infraBUIDL(AI) grant is meant to cover. Design gates every
> real-cost path so nothing can silently spend money.

---

## 8. Definition of done (the one test that matters)

> A person who has never used Avalanche opens `avakit.dev`, clicks **Try it now**,
> and completes a **real Fuji deploy + mint in under 60 seconds** — no install, no
> signup, no seed phrase, no gas — then runs `npm create avalanche-app` and gets
> that same app locally. When that is true and instrumented on `/stats`, Pillar 1
> is done and the "independent, low-barrier" product the Team1 lead asked for
> exists.
