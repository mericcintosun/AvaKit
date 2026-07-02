# 04 — Architecture Decision Records (ADR)

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

Each decision: **context → decision → rationale → consequences → alternatives.** Status: `Accepted` (approved in the planning phase) / `Proposed` (open for discussion).

---

## ADR-001 — Default embedded wallet provider: Web3Auth (MetaMask Embedded Wallets)
**Status:** Accepted

**Context.** Social-login onboarding is the heart of the product. Writing our own key management would be a security risk and would mean competing with Ava Labs WaaS. Candidates: Web3Auth (free tier, open SDK, C-Chain support), AvaCloud WaaS (paid/closed, Cubist HSM), Privy/Dynamic/Turnkey (general).

**Decision.** The default provider is **Web3Auth**. It is abstracted behind the `WalletAdapter` interface; the **AvaCloud WaaS** and **Injected (Core/MetaMask)** adapters are optional.

**Rationale.**
- Free tier → a vibe coder starts at zero cost (anti-lock-in, open-source spirit).
- Officially supported on Avalanche C-Chain.
- Thanks to the adapter pattern, switching providers is a single line.

**Consequences.** Requires a Web3Auth client ID (obtained for free); the template `.env.example` must document it. If the Web3Auth API breaks, the adapter isolates it.

**Alternatives & why not.** If AvaCloud WaaS were the default: cost + lock-in + closed source → contrary to our positioning (still valuable as an opt-in adapter). Own wallet → security risk (rejected).

---

## ADR-002 — Monorepo tool: pnpm workspaces + Turborepo
**Status:** Accepted

**Context.** 4 packages + templates + examples in a single repo. Shared types and atomic changes are needed.

**Decision.** **pnpm workspaces** (package management) + **Turborepo** (task orchestration/cache) + **Changesets** (versioning).

**Rationale.** pnpm is fast + disk-efficient + provides strict dependency isolation. The Turbo cache speeds up CI. It is standard in the ecosystem; vibe coders / EVM devs find it familiar.

**Consequences.** `pnpm` is mandatory (enforced in CI). Alternatives: Nx (heavier), Lerna (declining maintenance) — rejected.

---

## ADR-003 — Frontend stack: Next.js 16 + React 19 + wagmi + viem + Tailwind v4 + shadcn/ui
**Status:** Accepted (updated with project rules — see [doc 11](11-conventions.md))

**Context.** For the templates and the widget we need a modern stack that is familiar to EVM devs and well understood by AI tools. The project owner fixed the UI library to **shadcn/ui only**.

**Decision.** **Next.js (App Router, latest stable — currently 16)** + **React 19** + **wagmi** (React hooks) + **viem** (low level) + **Tailwind v4** + **shadcn/ui** (single UI library). Animation: **Framer Motion / GSAP**. Theme: dark/light from the start with **next-themes**; **black/white only** until M3 is done.

**Rationale.** viem/wagmi is the EVM standard; Claude/Cursor know these APIs well (AI ergonomics). Next.js is the most widespread React meta-framework. shadcn/ui is built on Tailwind + Radix, a11y for free, well understood by AI tools, and its copy-and-own model is free of vendor lock-in.

**Consequences.**
- The core (`@avakit/core`) still stays framework-agnostic (depends on viem only); everything React-specific lives in `@avakit/react`.
- **BuilderKit UI is NOT USED** (the previous "wrap BuilderKit" decision is cancelled). Avalanche-specific components are built from scratch on top of shadcn primitives. This may create overlap with Ava Labs, but the project rule (shadcn-only) is binding; it also lets us fully control our own design language (black/white, theme-first).

**Alternatives.** ethers.js (dropped in favor of viem), Vite SPA (Next.js is more widespread; a Vite template may be added later), BuilderKit UI (rejected due to the shadcn-only rule).

---

## ADR-004 — Smart contract tooling: Foundry primary, Hardhat optional
**Status:** Accepted

**Context.** The official `avalanche-starter-kit` uses Foundry; consistency and speed matter.

**Decision.** **Foundry (forge/cast)** is the primary compile/deploy path; **Hardhat** is an optional template variant.

**Rationale.** Aligned with the official starter-kit, fast, and widespread. A variant is kept for JS-heavy teams that want Hardhat.

**Consequences.** The `@avakit/core` deploy helper reads the Foundry artifact format (`out/*.json`). The Hardhat variant handles a separate artifact path.

---

## ADR-005 — MCP deploy path: wrap `@avakit/core`, don't rewrite `avalanche-cli`
**Status:** Proposed

**Context.** How should the MCP `deploy_contract` tool deploy? Two paths: (a) our own core deploy helper, (b) call `avalanche-cli` from the shell.

**Decision (proposed).** For contract/dapp deploys, use the **`@avakit/core` deploy helper**. If a Subnet/L1 *launch* is needed, wrapping `avalanche-cli` is reasonable (there `utkucy/avalanche-mcp-tools` already exists; we don't redo it, we compose if needed).

**Rationale.** A single deploy path → consistent behavior (CLI and MCP use the same core). L1 launch is rare and a separate domain.

**Consequences.** The v1 MCP scope focuses on dapp/contract; L1 launch goes to the backlog.

---

## ADR-006 — License: MIT
**Status:** Accepted

**Context.** Open source + free is the core differentiation against AvaCloud WaaS.

**Decision.** All packages **MIT**.

**Rationale.** A permissive license maximizes adoption; vibe coders and companies use it without hesitation. It is the legal backbone of the positioning ("the open alternative").

**Consequences.** The licenses of the wrapped dependencies (Web3Auth, BuilderKit, viem) must be MIT-compatible; this must be verified before M1.

---

## ADR-007 — Chain default: testnet-first (Fuji), mainnet opt-in
**Status:** Accepted

**Context.** A new dev should not be put at risk with real money on mainnet.

**Decision.** The default chain is **Fuji testnet**; the faucet link and test AVAX flow are documented. Mainnet (C-Chain) is explicit opt-in + confirmation before deploy.

**Rationale.** A safe default = low friction + low risk. Time-to-first-tx is measured on the testnet.

**Consequences.** Templates ship with a deploy to Fuji; mainnet has an extra verification step (see the Scaffolder/MCP spec).

---

## ADR-008 — Language: TypeScript + Solidity, end-to-end type safety
**Status:** Accepted

**Context.** For AI tools and EVM devs, type safety is a large part of the DX.

**Decision.** All JS/TS packages in **TypeScript**; type generation from contract ABIs (e.g. wagmi cli / abitype).

**Rationale.** Errors are caught at compile time; AI-generated code is "validated" by the types; autocomplete is strong.

**Consequences.** A codegen step in the build pipeline; when the ABI changes, the types are regenerated.

---

## ADR-009 — Design constraints: shadcn-only UI, Framer/GSAP, black-and-white + theme-first
**Status:** Accepted (project owner rule)

**Context.** A consistent, minimal design language that can be easily colored later is desired.

**Decision.**
- UI only **shadcn/ui** (no other component lib, BuilderKit UI not included).
- Animation only **Framer Motion** or **GSAP**.
- **Black/white only** until M1–M3 (product) is done; **dark/light theme from the start** (`next-themes`); color **last**.
- Goal: a **2026-modern, professional devtools** aesthetic (Linear/Vercel/shadcn-dashboard polish, colorless for now).

**Rationale.** A single UI language = consistency + low maintenance + strong AI ergonomics (the agent produces a single pattern). Adding color later on top of theme tokens becomes a token change rather than a refactor.

**Consequences.** All components are tested in both themes. Color tokens are defined as theme variables from the start. Details: [doc 11](11-conventions.md).

---

## ADR-010 — Version policy: the latest stable version of every frontend technology
**Status:** Accepted (project owner rule)

**Context.** A current stack is needed for a modern look and longevity.

**Decision.** Every frontend technology at **latest stable** (e.g. Next.js 16, React 19, Tailwind v4, latest shadcn/ui, latest next-themes). Versions are pinned in the lockfile.

**Rationale.** Alignment with the 2026-modern goal and with AI tools' up-to-date API knowledge.

**Consequences.** "Latest stable" is re-verified at implementation time (these numbers may change). Major upgrades are managed with Changesets.

---

## ADR-011 — M1 react layer: viem + React context (wagmi deferred)
**Status:** Accepted (M1)

**Context.** ADR-003's stack included wagmi. But at M1, for social login, the Web3Auth modal v11 wagmi integration (`@web3auth/modal/react/wagmi`) is version-volatile and **cannot be verified** without a client ID + a browser. Also, our own `WalletAdapter` abstraction already covers the connector layer.

**Decision.** At M1, `@avakit/react` is built on top of **viem + React context** (not wagmi). `AvaKitProvider` holds the connection state; the hooks (`useAvaAccount`, `useBalance`, `useContract`, `useAvaDeploy`) wrap viem.

**Rationale.** Full control, testability, no dependency on a volatile integration. `InjectedAdapter` (Core/MetaMask) is M1's verified path; `Web3AuthAdapter` is written/typed at the `@avakit/core/web3auth` subpath but its **live test is deferred pending a client ID**.

**Consequences.** wagmi compatibility can be added later as an optional layer (a wagmi connector wrapping the same adapter). The Web3Auth adapter is isolated; if the SDK API changes, only a single file is affected.

---

## ADR-012 — shadcn in a library: ship-style, not copy-in
**Status:** Accepted (M1)

**Context.** shadcn's model is to copy components into the application; an npm library (`@avakit/react`) cannot do that directly.

**Decision.** `@avakit/react` ships the shadcn **style** (Radix + Tailwind tokens) embedded; the consumer must have configured Tailwind with the shadcn tokens (the scaffolder templates and the example app provide this). Components use token classes such as `bg-primary`, `text-muted-foreground`.

**Rationale.** It preserves the "shadcn-only" rule, provides a single design language, and has no vendor lock-in. In Tailwind v4, the library's classes are scanned with `@source`.

**Consequences.** In the example app's `globals.css`, AvaKit classes are scanned with `@source "../../../packages/react/src"`. The M2 templates copy shadcn into the app (canonical shadcn) and use the AvaKit hooks.

---

## Pending decisions
- Default template set (proposal: `minimal`, `token-gated-app`, `nft-mint`).
- Web3Auth client ID distribution: does each dev obtain their own, or is there a shared ID for the demo? (proposal: dev obtains their own, documented; a throwaway for the demo).
- Docs site tool (proposal: Nextra or Fumadocs).

Related: [Architecture](03-architecture.md) · [PRD](01-prd.md)
