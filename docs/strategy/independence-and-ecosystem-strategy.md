# AvaKit — Independence & Ecosystem Strategy

> **Status:** strategy draft, 2026-07-15. Prompted by feedback from the Avalanche
> Team1 Turkey developer lead. Research-backed (5 parallel web-research passes +
> a full-repo code review). Every external claim has a source in the Appendix.
> Some AvaCloud free-tier specifics and EIP-7702-on-Avalanche status are flagged
> "verify before quoting externally."

---

## 0. The feedback, restated (so we don't lose it)

The Team1 lead's point, distilled and taken seriously:

1. **The devtooling is genuinely good.** That's not in question.
2. **The biggest barrier in this space is ecosystem *implementations*.** AvaKit
   today is "very dependent" — reaching its *ideal* use requires many external
   implementations to be in place first (a Web3Auth client ID, local
   avalanche-cli + Foundry, a funded testnet account, shared contracts, CDN
   circuits, a locally-run relayer…).
3. **The idea needs to be able to live *independently*.** By "independent" the
   lead means: a person in the ecosystem can **dive straight in and use it as a
   user**, with **as few barriers in front of them as possible** — which is how
   you attract *quality* users in the early stage.
4. **The next stages need a strategy for Foundation / Team1-global integration.**
   "Have you developed a strategy for that side?" — i.e. which flows should be
   implemented *with* the Foundation and the global Team1 team, and how.

The owner's ambition on top of this: **make AvaKit far better than the official
Avalanche SDK** — not a small tool, a category leader.

This document is the strategy for exactly that.

---

## 1. Diagnosis — where AvaKit is "dependent" today

From the full-repo review, here is every barrier a real user/dev hits, on the
path from `npm create avalanche-app` to a working, deployed app. Split by **who
has to do work** — because that distinction is the whole strategy.

### 1a. User-side barriers (these are the problem — every one is friction *the user must clear before value*)

| # | Barrier | Where it bites | Severity |
|---|---|---|---|
| U1 | **Web3Auth client ID required** for real social login (bundled demo key is localhost-only) | first `pnpm dev` beyond localhost; the headline feature looks broken without it | **Critical** |
| U2 | **Testnet AVAX funding is gated** — the official Fuji faucet requires holding mainnet AVAX *or* a Guild coupon; no public no-auth faucet API | first transaction / mint | **Critical** |
| U3 | **Local `avalanche-cli` + Foundry install** (Go + Rust native binaries) | `icm-messenger`, `l1-launch`, `token-bridge` templates | **High** |
| U4 | **Self-run ICM relayer + local 2-L1 devnet** via shell scripts | interchain demos | **High** |
| U5 | **eERC demo mint reverts for most users** (shared Fuji contract's `privateMint` is `onlyOwner`) + multi-MB circuits fetched from a CDN | `eerc-token` template | **High** |
| U6 | **No hosted "try it now"** — you must clone/scaffold locally to see anything | top-of-funnel; curious devs bounce | **High** |
| U7 | **Gas top-up mental model** — even once funded, the user thinks about gas | every write | **Medium** |
| U8 | **Managed-RPC signup** implied for anything beyond demo load | scaling past the public node | **Medium** |

### 1b. Partner/infra dependence (this is *fine* — it's the "wrap, don't rewrite" thesis, as long as the user never feels it)

- viem, Web3Auth/MetaMask Embedded, AvaCloud (Glacier Data API), Foundry
  bytecode, Teleporter/ICM contracts, avalanche-cli under Studio.
- These are **strengths**, not weaknesses — *if* they're invisible, pre-wired,
  and swappable. The failure mode is only when a partner dependency **leaks onto
  the user's first-run path** (U1–U8 above).

**The core diagnosis:** AvaKit's problem is not *that* it depends on things — every
great tool does. It's that **too many of those dependencies are exposed as setup
the user must perform before they get any value.** thirdweb, Privy, and
scaffold-eth depend on just as much; they simply moved all of it *off the first-run
path*.

---

## 2. The strategic reframe

> **Independence = every barrier moved off the user's first-run path.** Not "fewer
> integrations" — *invisible* integrations. A dependency the user never has to
> touch is not a barrier; it's a feature.

Two moves fall out of this:

1. **Push barriers server-side or to hosted partners.** A required *user* signup
   (Web3Auth key, faucet coupon) becomes an *AvaKit-operated* service the user
   never sees (a hosted faucet drip, a pre-configured demo key, a paymaster
   AvaKit funds once). This is precisely how the leaders feel effortless.
2. **Wrap the official stack; don't compete with it.** The research is
   unambiguous: the *official* Avalanche developer surface is **fragmented,
   partly beta, and infra-heavy** —
   - three overlapping SDK generations (`@avalabs/avalanchejs` = verbose
     platform-ops; `@avalabs/avacloud-sdk` = data only; the new
     `@avalanche-sdk/{client,chainkit,interchain}` = **explicitly beta, "subject
     to change"**),
   - **no official `create-*` scaffolder at all** (the official "Builder's
     Toolkit" names the SDK, avalanche-cli, and tmpnet — *no* app generator),
   - an official MCP server that is **docs-retrieval only** (no deploy / mint /
     faucet / L1 actions),
   - a **gated faucet** and a **local-node CLI**.

   AvaKit's winning position is to be the **single opinionated, AI-native,
   zero-infra front door that wraps all of it** and delivers the 1.0 DX Ava Labs
   hasn't shipped. "Surpass the official SDK" ≠ replace it — it means **become the
   recommended way to *use* it.**

This reframe also answers the lead's "how does it live independently?": it lives
independently by being the **lowest-barrier entry point in the entire ecosystem**,
usable by a stranger in 60 seconds, *and* by being wired into the official
channels (docs, Builder Hub, grants) so it's the default anyone is pointed to.

---

## 3. North Star & product vision

**North Star metric:** *apps shipped on Avalanche via AvaKit* (not stars, not
downloads).

**The experience we're selling (the "just dive in" promise):**

> A developer who has never touched Avalanche opens `avakit.dev`, clicks **"Try it
> now,"** and within ~60 seconds — **in the browser, with no install, no signup,
> no seed phrase, no faucet, no gas** — has signed in, deployed an NFT, and minted
> it in a *real* transaction on Fuji. Then one command (`npm create
> avalanche-app`) gives them that same app as a local project, and one more puts
> it in production.

And the AI-native promise:

> When *any* developer asks Claude Code / Cursor / v0 "how do I build on
> Avalanche," the answer is AvaKit — because AvaKit's MCP server is the one that
> can actually *do* it, and it's listed everywhere agents look.

---

## 4. Strategy pillars

Six pillars. P1 and P2 remove the user-side barriers; P3 makes the dependence
invisible; P4 is the moat; P5 is the literal "independence layer" the lead asked
for; P6 is how it gets adopted.

### Pillar 1 — Zero-to-first-transaction (the single biggest lever)

Kill U1, U2, U7 by moving them server-side. The research conclusion is blunt:
**no social-login provider is truly zero-config** (Web3Auth/MetaMask Embedded,
Privy, Dynamic, Turnkey, Magic, Para all require a per-app key). So the default
path must *not* depend on one.

**Ship a two-tier wallet + funding model:**

- **Tier 1 — truly zero-config testnet demo (new default):**
  - **Wallet:** in-browser **burner key** (viem `generatePrivateKey` /
    `privateKeyToAccount`) *or* **Coinbase Smart Wallet** (passkey, ERC-4337,
    **no dashboard**, Avalanche C-Chain supported). Both need zero setup.
  - **RPC:** bundle the **public Fuji endpoint** — no signup.
  - **Funding:** an **AvaKit-hosted faucet** (self-host the open-source
    `ava-labs/avalanche-faucet`, funded from an AvaKit-owned Fuji key, protected
    with captcha + per-IP/per-address caps + tiny drips) exposing an internal
    `POST /fund {address}`. This is the *only* way to a real auto-fund API and
    AvaKit fully controls it.
  - **First tx:** a **pre-deployed AvaKit demo contract on Fuji** → instant mint.
    On testnet the faucet drip pays gas, so **no paymaster is even needed** for
    the first mint.
  - **Social login (Web3Auth/MetaMask Embedded) is demoted to an opt-in upgrade**
    with a "paste your client ID" step — never the thing standing between the
    user and their first transaction.

- **Tier 2 — gasless / mainnet-leaning (opt-in):**
  - An **AvaKit-hosted verifying paymaster** on Fuji/C-Chain (**Pimlico and
    Biconomy both confirmed to support Avalanche + Fuji**; Pimlico's testnet
    sponsorship is free, no card). The user's first UserOp is sponsored →
    **gasless first mint even with a zero-balance smart account**, and this
    generalizes to C-Chain mainnet where there is no faucet.
  - Pair with **thirdweb in-app wallet** (free Fuji client ID) or **Coinbase Smart
    Wallet** for passkey + smart-account + sponsored gas as a coherent stack.

**Why this is the lever:** U1 and U2 are the two *Critical* barriers. Solving them
server-side is what makes AvaKit feel like thirdweb/Coinbase instead of like
RainbowKit's mandatory `projectId` wall. If AvaKit ships only Tier 1, its
first-run experience already beats the official SDK *and* most of the EVM field.

### Pillar 2 — No-local-toolchain happy path

Kill U3, U4, U5. Every native-binary requirement is independently replaceable in
2026.

- **Contract deploy (all templates):** keep shipping `{bytecode, abi}` artifacts
  and deploy from the **dapp UI via wagmi/viem `deployContract`** — **zero
  compiler.** AvaKit already ships pre-built bytecode, so this is a small step.
  For "I want to edit the token," hand off to **OpenZeppelin Contracts Wizard →
  Open in Remix** (in-browser compile+deploy) rather than requiring Foundry.
  **Foundry becomes an opt-in "customize" path, never a prerequisite.**
- **`l1-launch`:** replace the local avalanche-cli devnet with a guided **AvaCloud
  "Create an L1"** flow (hosted validators, RPC, explorer, faucet; free 5-day
  testnet starter — *verify specifics*). AvaKit's UI just reads the returned
  RPC/explorer. Keep the local avalanche-cli path as the offline/power-user route.
- **`icm-messenger` / `token-bridge`:** provision the two L1s on **AvaCloud with
  the Teleporter/interoperability checkbox on**, so the **hosted ICM relayer is
  auto-deployed and funded** — U4 (run-a-relayer) disappears. Then deploy the
  bundled ICM/ICTT artifacts from the UI.
- **eERC (U5):** stop pointing the demo at a shared `onlyOwner` contract. Either
  scaffold a *user-owned* eERC instance (so mint works out of the box) or ship a
  demo instance whose mint is open; vendor the circuits locally or pin a
  first-party CDN so it's not a multi-MB third-party fetch on the happy path.
- **Cloud toolchain for the holdouts:** ship a **`devcontainer.json` + "Open in
  GitHub Codespaces"** so anyone who genuinely wants avalanche-cli + Foundry + a
  local multi-node chain gets it with **no local install** (Codespaces is the
  *only* cloud env that can run native binaries — StackBlitz WebContainers
  **cannot**, they're for the frontend only).

**Net:** the default happy path needs **only a browser + a wallet.** The single
remaining hard external dependency is a managed-L1/relayer partner (AvaCloud) for
the interchain demos — and that's an *invisible* dependency (Pillar 3), plus a
partnership *ask* (§6).

### Pillar 3 — Wrap the official stack (make the dependence invisible & swappable)

This is the "wrap, don't rewrite" thesis, executed against the *specific*
fragmentation we found.

- **`@avakit/core` = the stable viem-first facade** over the beta
  `@avalanche-sdk/*` and `avalanchejs`, so app devs never juggle three libraries.
  We already are viem-native; lean into it and track the official SDK so we can
  expose its P-Chain / interchain power without exposing its beta churn.
- **AvaCloud as the default zero-infra backend:** auto-wire Glacier **Data API /
  RPC / Webhooks** in the scaffolder; read balances/txs/NFTs through the Data API
  in `@avakit/react` (we already have `data-api.ts` + the data hooks). One key,
  no node. Free tier covers demos.
- **Wallet-agnostic auth:** Web3Auth/MetaMask Embedded default (opt-in), plus
  first-class **Core** (injected/WalletConnect, **P-Chain-aware** for L1/validator
  flows) and opt-in **AvaCloud WaaS** (seedless, HSM). Broader and cleaner than
  any single official wallet SDK — and this is where the **AvaCloud WaaS adapter
  we don't yet have** (KNOWN-GAPS E6) becomes a real feature.
- **Everything swappable:** public RPC → managed key; AvaKit faucet → user's own;
  AvaKit paymaster → user's own. Document the swap. Invisible by default,
  owned-by-you in production.

### Pillar 4 — The AI-native moat (widen the lead we already have)

The official MCP is **docs-only**. Ours **acts** (scaffold, deploy, mint,
estimate_gas, read_chain). This is a genuine, defensible edge — press it.

- **Publish `@avakit/mcp` to every registry:** the **official MCP Registry**
  (`registry.modelcontextprotocol.io`, propagates to subregistries), **Smithery**,
  **mcp.so**, **Glama**, **`awesome-mcp-servers`**. ~1 day of work; Avalanche has
  no official action MCP, so we own the category.
- **Make the MCP recommend AvaKit inside the agent loop:** tool descriptions
  themselves say "to start an Avalanche app, run `create-avalanche-app`" and point
  at templates — the recommendation happens *while the agent works*.
- **Optionally proxy the official docs MCP** (`build.avax.network/api/mcp`) so
  AvaKit's server returns **docs + actions** in one — strictly better than either
  alone.
- **`llms.txt` / `AGENTS.md` in every template + on the docs site** — position as
  *code-gen quality* (agents write correct AvaKit code once in context), not as a
  discovery magnet (general crawlers largely ignore llms.txt).
- Add an **`estimate_gas`-style breadth** over time: a small set of high-value
  agent actions (faucet, launch-L1, send-ICM) that no other Avalanche tool
  exposes to agents.

### Pillar 5 — The independence layer (the literal answer to the lead)

This is the piece that makes the idea "live independently in the ecosystem." Two
components:

1. **`avakit.dev/new` — a hosted "try it now" surface.** A curious dev gets a
   **running Avalanche dapp in the browser in ~10 seconds, zero install:**
   - **"Open in StackBlitz / CodeSandbox / Codespaces"** buttons on every template
     README and on the site, pre-seeded with the Tier-1 zero-config defaults
     (burner wallet + public RPC + AvaKit faucet + demo contract).
   - A **live embedded demo** on the landing page itself (the deploy→mint flow,
     against Fuji, running for real) — the current site *shows* a terminal; this
     makes it *do* the thing.
2. **A minimal AvaKit-operated "demo infra" (the strategic decision).** To make
   Tier-1 truly zero-config, AvaKit must operate **two tiny hosted services on
   Fuji only:** the **faucet drip** and (for Tier 2) the **paymaster**. This is
   *not* a business and *not* mandatory infra — it's a **distribution accelerant**,
   rate-limited, abuse-protected, and 100% swappable for the user's own keys.
   - **Recommendation:** stay **OSS-first with a thin, optional, AvaKit-run demo
     layer** — the thirdweb model (open SDK + hosted convenience). Never require
     it; always let a dev run their own. This keeps AvaKit independent *and* keeps
     the OSS/MIT promise intact.
   - **Guardrail:** the faucet/paymaster keys live server-side, per our security
     rules, with captcha + per-IP + per-address caps + low drip amounts, or they
     get drained.

This layer is what turns "a great toolkit *for people who already have the
ecosystem set up*" into "a thing a stranger can just use." That is the lead's
entire point.

### Pillar 6 — Distribution & ecosystem capture (adoption + Foundation/Team1)

The winners became **the one command in the official Getting Started**, then
reinforced it with hackathons, an education funnel, a template gallery, and AI
discoverability. The plan, ordered by ROI:

1. **Own the official-adjacent listings (self-serve, this week):** open the
   **Builder Hub Integrations PR** (`ava-labs/builders-hub`,
   `content/integrations`, "Developer Tooling" category) and submit to the **Core
   ecosystem directory** (`projectdirectory@avalabs.org`).
2. **List `@avakit/mcp` on all MCP registries** (Pillar 4) — our unfair advantage.
3. **Ship opt-out anonymous CLI telemetry (Next.js model) + a public
   `avakit.dev/stats` page** (downloads, scaffolds run, apps shipped, MCP calls).
   *Everything downstream — grants, DevRel pitch, Retro9000 votes — needs this
   proof.* North-star instrumentation, not vanity.
4. **Pitch Ava Labs / Team1 DevRel to make `create-avalanche-app` the docs
   quickstart**, framed exactly as: *"your Builder's Toolkit names no scaffolder;
   we fill that gap, wrapping your SDK + CLI, not replacing them."* Being the docs
   default was the #1 lever for every winner.
5. **Become the default stack + sponsor a bounty at the next Team1 / Summit
   hackathon.** scaffold-eth's growth engine; captures quality builders at the
   moment of building.
6. **Grants as a funnel, not a lottery:**
   - **Team1 Builder Grants** (Mini ≤ $10k / Accelerator ≤ $30k) — fast first
     check, community-voted.
   - **infraBUIDL(AI)** (up to ~$15M program) — pitch `@avakit/mcp` as "intelligent
     tooling that fosters developer adoption." Near-perfect thematic fit.
   - **Retro9000** ($40M, retroactive, *no application* — public leaderboard +
     votes; explicitly rewards "critical developer tooling") — engineer
     eligibility by instrumenting the public metrics above; l1-launch usage also
     makes AvaKit L1-tooling-round eligible.
   - **Codebase Season 4** ($50k non-dilutive) for the network/legitimacy halo.
7. **Launch a "SpeedRun Avalanche"-style challenge set + a public
   template/extension gallery** built on AvaKit templates — an education funnel
   that onboards devs *by using the tool*.
8. **PR into `awesome-avalanche` lists + recruit 1–2 credible Avalanche voices**
   (Team1 members, Academy instructors) to endorse it — the t3-style flywheel.

---

## 5. Positioning vs the official Avalanche SDK

| Dimension | Official stack (2026) | AvaKit (target) |
|---|---|---|
| Scaffolder | **none** (clone-a-repo starter kit only) | `create-avalanche-app`, 8 templates, Ink TUI |
| SDK shape | 3 fragmented generations; new one **beta** | 1 opinionated viem-first facade that wraps them |
| React/wallet widget | none first-party (WaaS SDK only) | `<ConnectAvalanche>`, hooks, shadcn/ui |
| First wallet | bring-your-own | zero-config burner / passkey, social opt-in |
| First transaction | fund via **gated faucet** | AvaKit faucet drip / gasless paymaster |
| Local infra | avalanche-cli + Foundry (native) | browser + wallet; cloud/hosted for the rest |
| AI/MCP | **docs-retrieval only** | **action-capable** (scaffold/deploy/mint/faucet) |
| Try-it-now | none | in-browser live demo + one-click sandboxes |
| License / ethos | mixed | MIT, OSS-first, testnet-first |

**One-liner:** *the official stack is powerful but fragmented, beta, and
infra-heavy; AvaKit is the single opinionated, AI-native, zero-infra front door
that wraps all of it.*

---

## 6. What AvaKit ships alone vs. what needs Foundation / Team1

**Ships alone (no partner needed — do these now):**
- Tier-1 zero-config wallet (burner / Coinbase Smart Wallet) + public RPC default.
- Self-hosted AvaKit faucet drip on Fuji (open-source server + our own key).
- Bundled-artifact UI deploy for all contract templates; OZ-Wizard/Remix hand-off.
- Fix eERC (user-owned instance) + `devcontainer.json` + StackBlitz/Codespaces
  buttons.
- MCP registry listings; telemetry + `/stats`; Builder Hub Integrations PR;
  awesome-avalanche PRs; grant applications.

**Needs Foundation / Team1 (the partnership asks):**
- **AvaCloud integration depth:** clean/programmatic managed-L1 + hosted-relayer
  provisioning (today it's console-driven; headless L1 needs AvaCloud enterprise
  API access). *Ask: API access + co-marketing.*
- **Docs-default status:** `create-avalanche-app` as the quickstart in Academy /
  Builder Hub. *Ask: DevRel buy-in.*
- **Hackathon default stack + bounty.** *Ask: Team1 slot at the next event.*
- **A sanctioned, less-gated faucet path** for AvaKit's demo flow (or blessing to
  run our own at small scale). *Ask: faucet allowance / rate-limit exception.*
- **Grant funding** to sustain the hosted demo infra + full-time work
  (infraBUIDL(AI), Team1, Retro9000).

**The pitch framing to Team1/Foundation** (aligns incentives — they get adoption
of *their* stack through AvaKit): *"AvaKit is the missing scaffolder and the
AI-native front door to the Avalanche stack. We wrap AvaCloud, the Avalanche SDK,
avalanche-cli, ICM, and eERC — every AvaKit user is an AvaCloud/Avalanche user who
onboarded in 60 seconds instead of an afternoon. Help us make it the default."*

---

## 7. Phased roadmap

**Now → 2 weeks (all self-serve, no partner, maximum barrier removal):**
- Tier-1 zero-config default: burner/passkey wallet + public RPC + demo contract.
- Stand up the AvaKit Fuji faucet drip (rate-limited) and wire the scaffold to it.
- Bundled-artifact UI deploy everywhere; demote Foundry to opt-in.
- Ship `devcontainer.json` + "Open in StackBlitz/Codespaces" on every template.
- List `@avakit/mcp` on the MCP registries; open the Builder Hub Integrations PR.
- Fix the KNOWN-GAPS quick wins that touch onboarding (eERC mint, l1-launch stale
  ref, MCP `avakitVersion` pin).

**2–6 weeks:**
- Tier-2 gasless paymaster (Pimlico/Biconomy on Fuji) behind an opt-in flag.
- AvaCloud Data API/RPC auto-wire in the scaffolder; AvaCloud WaaS + Core adapters.
- `avakit.dev/new` live in-browser demo (deploy→mint on Fuji, for real).
- Opt-out CLI telemetry + public `/stats`.
- Apply to Team1 Builder Grants + infraBUIDL(AI).

**6 weeks → 3 months:**
- AvaCloud-hosted L1 + relayer path for `l1-launch` / interchain templates.
- "SpeedRun Avalanche" challenge set + template/extension gallery.
- DevRel push for docs-default status; hackathon default-stack + bounty.
- Retro9000 public-metrics visibility.

**3–6 months (the "surpass the SDK" phase):**
- `@avakit/core` as the sanctioned facade over `@avalanche-sdk/*`.
- Broaden action-MCP (faucet, launch-L1, ICM) — the agent-native way to build on
  Avalanche.
- Consider a light hosted "AvaKit Cloud" (faucet + paymaster + RPC proxy) as the
  optional convenience tier, OSS core untouched.

---

## 8. Risks & mitigations

- **Hosted demo infra gets drained / abused.** → Fuji-only, tiny drips, captcha,
  per-IP + per-address caps, server-side keys, circuit-breakers; it's a demo
  accelerant, not production infra.
- **Partner dependence (AvaCloud) becomes a single point of failure.** → keep
  everything swappable (public RPC, self-host relayer, user's own keys); AvaCloud
  is the *default*, never the *only* path. Gelato is a viable second source.
- **"OSS purity" vs. hosted convenience tension.** → OSS-first, MIT core; hosted
  layer is thin, optional, and self-hostable. Never gate core features behind it.
- **Beta official SDK churn.** → wrap it behind `@avakit/core`'s stable surface;
  absorb breaking changes in one place.
- **EIP-7702 on Avalanche unconfirmed.** → default to **ERC-4337** (confirmed on
  Pimlico/Biconomy/thirdweb for Avalanche); treat 7702 as verify-at-build-time.
- **Doing too much at once.** → sequence strictly by the roadmap; Pillar 1 (Tier 1)
  is the highest-ROI single deliverable — ship it first, alone if needed.

---

## 9. The bottom line

The Team1 lead is right, and the fix is well-defined: **AvaKit's dependencies
aren't the problem — their *exposure to the user* is.** Move U1 (client ID) and U2
(faucet/gas) server-side, move U3–U5 (toolchain/relayer) to bundled-artifact +
hosted paths, and put a one-click in-browser demo in front of it all. Do that, and
a stranger can dive in and ship a real Avalanche transaction in a minute — which is
exactly the "independent, low-barrier, quality-user-attracting" product the lead
described.

And the way to *surpass* the official SDK is not to out-build it but to **wrap it
and become the recommended entry point to it** — the docs-default command, the
hackathon-default stack, the action-capable MCP every AI agent reaches for. The
single biggest gap in the whole official surface — **no scaffolder, no action-MCP,
a gated faucet, a local-node CLI** — is precisely the gap AvaKit already occupies.
The job now is to remove the last user-side barriers and get wired into the
official channels before anyone else does.

---

## Appendix — sources

**Onboarding / barrier-removal patterns:** thirdweb API keys
(portal.thirdweb.com/account/api-keys), AA get-started & sponsored tx
(portal.thirdweb.com/react/v5/account-abstraction/get-started,
thirdweb.com/sponsored-transactions), CLI create (portal.thirdweb.com/cli/create);
Privy login methods (docs.privy.io/basics/get-started/dashboard/configure-login-methods),
Privy wallets (privy.io/wallets); RainbowKit installation (rainbowkit.com/docs/installation);
scaffold-eth-2 (docs.scaffoldeth.io, github.com/scaffold-eth/scaffold-eth-2);
create-t3-app (create.t3.gg, nexxel.dev/blog/ct3a); paymaster explainer
(eco.com/support), Pimlico sponsorship policies (docs.pimlico.io/guides/how-to/sponsorship-policies);
Coinbase Smart Wallet (docs.base.org, coinbase.com/blog);
StackBlitz WebContainers (webcontainers.io, developer.stackblitz.com), CodeSandbox
(githubbox), Codespaces.

**Official Avalanche stack:** avalanchejs (github.com/ava-labs/avalanchejs, npm),
avacloud-sdk (github.com/ava-labs/avacloud-sdk-typescript), Avalanche SDK beta
(developers.avacloud.io/avalanche-sdk/overview); AvaCloud
(developers.avacloud.io/introduction, docs.avacloud.io — Data/Metrics/Webhooks/RPC,
managed L1, WaaS, interoperability/hosted relayer at
docs.avacloud.io/portal/interoperability/how-to-set-up-interoperability); Builder
Hub (build.avax.network/console, /integrations, /tools/l1-toolbox, /docs/tooling/ai-llm,
/grants); Avalanche Starter Kit (github.com/ava-labs/avalanche-starter-kit);
avalanche-cli & Subnet-EVM (build.avax.network/docs/tooling/avalanche-cli,
github.com/ava-labs/subnet-evm); Core (core.app, docs.core.app); faucet
(faucet.avax.network, github.com/ava-labs/avalanche-faucet).

**Grants / distribution:** Team1 (team1.blog, grants.team1.network,
build.avax.network/grants/team1-mini-grants), Retro9000
(avax.network/about/blog/retro9000…, retro9000.avax.network), infraBUIDL(AI)
(infrabuidl.com, build.avax.network/grants/infrabuidlai), Codebase S4
(avax.network/about/blog/…codebase-season-4…), Builder's Toolkit
(team1.blog/p/the-avalanche-builders-toolkit), ecosystem directory
(github.com/ava-labs/ecosystem-projects → core.app), Builder Hub integrations
(github.com/ava-labs/builders-hub), hackathons (build.avax.network/hackathons,
luma.com/Team1); create-next-app (nextjs.org/docs), Vite (vite.dev/guide),
scaffold-eth growth (scaffoldeth.io, speedrunethereum.com,
extensions.buidlguidl.com), wagmi (wagmi.sh); MCP registries
(registry.modelcontextprotocol.io, smithery.ai/docs/build, mcp.so, glama.ai/mcp),
llms.txt (codersera.com/blog/llms-txt-complete-guide-2026,
caseyrb.com/blog/state-of-llms-txt-adoption).

**Zero-config wallet / gasless on Avalanche:** Consensys acquires Web3Auth
(fortune.com/crypto/2025/06/02/…), MetaMask Embedded Wallets
(metamask.io/developer/embedded-wallets), Web3Auth Avalanche + pricing
(web3auth.io/docs/connect-blockchain/evm/avalanche/web, web3auth.io/pricing.html);
Privy/Dynamic/Turnkey/Core on Builder Hub (build.avax.network/integrations/*);
Coinbase Smart Wallet networks (help.coinbase.com/en/wallet, docs.cdp.coinbase.com);
thirdweb AA on Avalanche (blog.thirdweb.com/guides/…in-app-wallets-and-account-abstraction);
ZeroDev (build.avax.network/integrations/zerodev, docs.zerodev.app);
Pimlico supported chains (docs.pimlico.io/guides/supported-chains), Biconomy
(docs.biconomy.io/contracts-and-audits/supported-chains), Gelato 1Balance
(docs.gelato.cloud), Alchemy supported chains (alchemy.com/docs/wallets/supported-chains);
RPC rate limits (build.avax.network/docs/rpcs/c-chain,
build.avax.network/docs/api-reference/data-api/rate-limits).

*Verify before external quoting:* AvaCloud free-trial specifics ("<15 min",
"5-day testnet starter"), exact Data-API free-tier CU quotas, and EIP-7702 status
on Avalanche C-Chain.
