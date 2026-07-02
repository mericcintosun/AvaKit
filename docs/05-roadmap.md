# 05 — Roadmap

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

## Philosophy: vertical slice, not broad-but-shallow

Doing all three surfaces at once is a trap. Each milestone ships something **usable on its own**; even if it stalls halfway, there is value left in hand. Order: **core → scaffolder → AI surface.**

```
M1  @avakit/core + @avakit/react        →  "working social-login + first tx" proof
M2  create-avalanche-app + templates    →  "dapp in one command" (vibe coder hook)
M3  @avakit/mcp + AI context            →  "scaffold+deploy from Claude/Cursor" (AI-native)
```

---

## M0 — Repo setup (COMPLETED ✅)
**Goal:** a workable monorepo skeleton. (Not code, infrastructure.)

Deliverables:
- [x] pnpm workspaces + Turborepo + Changesets monorepo (centralized versions via pnpm catalog)
- [x] TypeScript base config + **Biome** (single tool for lint/format)
- [x] Package stubs: `@avakit/core` (chain registry + WalletAdapter), `@avakit/react`, `@avakit/mcp` (working stdio skeleton), `create-avalanche-app`
- [x] MIT license (neutral), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- [x] Dependency license audit (all permissive; sharp/libvips LGPL native binary — Next transitive, not a problem)
- [x] UI baseline: shadcn/ui + Tailwind v4 + next-themes (dark/light), **black/white token set** — latest stable (Next 16, React 19, TS 6)
- [x] CI (`.github/workflows/ci.yml`): lint + typecheck + build + test (pnpm + Node 24). Runs when the repo is pushed.

Exit criterion: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` pass; `apps/web` runs. ✅

> Note: instead of "empty packages", M0 came with real-but-minimal content such as the core's chain registry (a comprehensive setup was preferred).

---

## M1 — Core + Widget (COMPLETED ✅ — except the live social-login test)
**Goal:** connect a wallet on Fuji, see the balance, send a tx — **inside an example app.**

`@avakit/core`:
- [x] Chain registry: Fuji, C-Chain, adding a custom L1 (from M0)
- [x] viem client factory (public + wallet)
- [x] `WalletAdapter` interface + `InjectedAdapter` (complete, tested) + `Web3AuthAdapter` (`@avakit/core/web3auth` subpath; written/typed, **live test deferred pending a client ID** — ADR-011)
- [x] Deploy helper (artifact → deploy → address) + `getBytecode`
- [x] Data: balance / tx receipt / contract read

`@avakit/react` (viem + context — ADR-011; UI shadcn-style — ADR-012):
- [x] `<AvaKitProvider>` (chains + adapters + connection state)
- [x] `<ConnectAvalanche>` (Radix Dialog, adapter selector)
- [x] Hooks: `useAvaAccount`, `useAvaChain`, `useBalance`, `useContract`, `useAvaDeploy`
- [x] shadcn-style components (Button/Dialog); dark/light + black/white

`examples/`:
- [x] `examples/hello-avax`: connect via injected (Core/MetaMask) + balance + 0-AVAX tx on Fuji (live demo; build + prerender verified)

**Exit criterion:** with `@avakit/react` + `<ConnectAvalanche>`, connect→balance→first tx works in a Next app (the injected path is verified). The social-login path (Web3Auth) awaits verification with a free client ID + a browser.

> **Scope note:** viem+context was chosen instead of wagmi (ADR-011); because the Web3Auth live flow is version-volatile and requires a client ID, it was left isolated/flagged. Injected (Core — Avalanche's native wallet) is M1's verified "wow".

---

## M2 — Scaffolder + Templates (COMPLETED ✅)
**Goal:** a full, deployable dapp in one command, using the M1 core.

`create-avalanche-app`:
- [x] Interactive CLI (@clack/prompts: template, wallet, chain, package manager)
- [x] Template render + dependency install + `.env.example` + dotfile rename (`gitignore`→`.gitignore`, etc.)
- [x] AI context injection: `CLAUDE.md`, `llms.txt`, `.cursor/rules/avakit.mdc`
- [x] `--yes` non-interactive mode (for MCP/CI) + `--no-install` + `--local` (workspace link)

Templates:
- [x] `minimal` — social login + connect + balance + tx (shadcn + black/white + dark/light)
- [x] `nft-mint` — deploy + mint from the browser; **self-contained ERC-721** (`contracts/src/AvaKitNFT.sol`) compiled with forge and the bytecode embedded in `lib/nft-artifact.ts` → deploy from the browser without installing Foundry
- [x] `token-gated-app` — content lock based on access-pass NFT ownership (`balanceOf > 0` → open); reuses the same ERC-721 + a security note (client-side gating is illustrative)

**Verification:** both templates were generated into the workspace with `--local` and **actually built** (Next compile + TS + prerender). Scaffolder output: correct structure, no placeholders, dotfile renames ✓, `manifest.json` does not leak ✓, AI context ✓. The NFT contract was compiled with forge.

**Exit criterion:** ✅ `create-avalanche-app` → a built dapp with social login and AI context; in `nft-mint`, a contract deployable from the browser. (A real on-chain deploy/mint requires gas — the code path is verified.)

> Note: the AvaKit packages are not on npm yet; the generated app depends on `@avakit/*@^0.1.0` in real usage (after publish). `--local` is for in-repo testing/development.

---

## M3 — MCP + AI-native layer (COMPLETED ✅)
**Goal:** scaffold + deploy from Claude Code / Cursor in natural language.

`@avakit/mcp` (stdio, `@modelcontextprotocol/sdk` 1.29 + zod 4):
- [x] MCP server (stdio) — `initialize`/`tools/list`/`tools/call` verified
- [x] Tool: `scaffold_app` (wraps create-avalanche-app via the programmatic `scaffoldApp` API)
- [x] Tool: `list_templates`
- [x] Tool: `read_chain` (balance / txReceipt / contractRead) — **tested against live Fuji RPC**
- [x] Tool: `deploy_contract` (viem + `AVAKIT_DEPLOYER_KEY`; testnet-default, **mainnet confirm:true required** — guardrail tested)
- [x] Tool: `get_context` (AvaKit API + conventions + doc links)
- [x] Setup: `{ "mcpServers": { "avakit": { "command": "npx", "args": ["-y", "@avakit/mcp"] } } }`

AI context (product-wide):
- [x] Each template ships with `CLAUDE.md` + `llms.txt` + `.cursor/rules` (M2)
- [x] The `get_context` tool provides the AvaKit context + a link to the official `llms.txt`

**Verification:** the MCP server was spawned and spoken to over JSON-RPC: 5 tools listed, `list_templates`/`scaffold_app` (15 files) worked, `read_chain` **read the Fuji balance live**, `deploy_contract` rejected mainnet without confirm. create-avalanche-app was exposed as a programmatic API (`/api`).

**Exit criterion:** ✅ From a Claude/Cursor MCP client, the `scaffold_app` → (with a funded key) `deploy_contract` chain can be established.

---

## M4+ — After (backlog)
- [x] **npm publish preparation** — versions 0.1.0, metadata/README/LICENSE, dry-run verified (see RELEASING.md)
- [x] **Product site (`apps/web`)** — landing (hero/surfaces/features/steps/templates/mcp/faq) + `/docs` (5 pages + sidebar) + `/templates`; shadcn-only, black/white, dark/light, Framer Motion; 8 routes prerendered
- [x] **`erc20-token` template** — self-contained ERC-20, deploy + mint + transfer from the browser (4 templates total)
- [ ] AvaCloud WaaS adapter (opt-in)
- [ ] Mainnet deploy flow + security confirmation gates (UI)
- [ ] Additional templates (DeFi swap, DAO, payment)
- [ ] Privy/Dynamic/Turnkey adapters
- [ ] Subnet/L1 launch tool (avalanche-cli compose, optional)
- [ ] Vite/React Native template variants
- [ ] Real npm publish (account side: npm login + @avakit org)

---

## Milestone dependencies

```
M0 ──> M1 ──> M2 ──> M3
              │
              └─> (without M2 there is no scaffold_app for M3)
The M1 widget is also used inside the apps M3 generates.
```

## Measurement (at the end of each milestone)
- M1: time-to-first-tx (target < 5 min)
- M2: time-to-running-dapp (target < 5 min, zero config)
- M3: end-to-end scaffold+deploy success rate with AI

Related: [PRD](01-prd.md) · [Architecture](03-architecture.md)
