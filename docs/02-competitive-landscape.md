# 02 — Competitive Analysis & Prior Art

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

**Research date:** 2026-07-01
**Question:** Has anyone built this product (scaffolder + embedded wallet SDK + MCP, AI-native, open source)?
**Short answer:** All the pieces exist individually; **no one has combined them and packaged them as AI-native.** The gap is real.

---

## Competitor map

| What | Who | Covers | Gap / our difference |
|---|---|---|---|
| Official starter kit | `ava-labs/avalanche-starter-kit` | Foundry + Avalanche CLI + Teleporter + Dev Container; cross-chain/education focused | ❌ no interactive scaffolder · ❌ no wallet onboarding · ❌ no frontend framework · ❌ no AI context |
| React component lib | `ava-labs/builderkit` | `ConnectButton`, `ConnectStatusIndicator`, chain selector, ICTT/faucet flow | ⚠️ injected-wallet focused; social-login/embedded is **not documented**; not a batteries-included app → **we build our own UI on top of shadcn/ui** (project rule: shadcn-only, [doc 11](11-conventions.md)) |
| Official TS SDK | `ava-labs/avalanche-sdk-typescript` | RPC, data/metrics, ICM/Teleporter | a low-level building block; not a scaffolder/widget/AI → **we use it** |
| Embedded wallet (WaaS) | **AvaCloud WaaS** (Cubist-backed) | Social login (Google/X/FB/Apple), React SDK, pre-built components, HSM key mgmt | ⚠️ **closed source + paid** (sales, allowlist, subscription), tied to the AvaCloud portal → **we are the open/free alternative + optional adapter** |
| Embedded wallet (free) | **Web3Auth / MetaMask Embedded Wallets** | Social login on Avalanche C-Chain, React SDK, free tier | chain-agnostic; no Avalanche-native packaging → **we make it the default provider** |
| Wallet (end user) | Core / Cubist CubeSigner | Seedless wallet (Google/Apple), HSM | not a dev SDK/widget; an end-user product |
| MCP (community) | `utkucy/avalanche-mcp-tools` | Wraps the Avalanche **CLI**: subnet/L1/VM management | ❌ no contract scaffold/deploy/wallet codegen |
| MCP (official) | build.avax.network + `llms.txt`/`llms-full.txt` | **docs retrieval** + some live data | ❌ no app setup/deploy → **we expose scaffold+deploy tools** |
| Generic scaffolder | Alchemy `create-web3-dapp` | general web3 scaffold | not Avalanche-native; not social-login-first; not AI-native |

## The gap (whitespace) — what we own

1. **An open-source + free, batteries-included scaffolder** where *social-login onboarding comes wired in by default.* The official starter-kit has no onboarding at all; AvaCloud's is paid/closed. This combination is empty.
2. **AI-native by default** — every generated app ships with `CLAUDE.md`/`llms.txt`/cursor rules + MCP exposing **scaffold+deploy** as tools. Existing MCPs only do CLI/docs. **No one holds this angle.**
3. There is no product that **unifies all three surfaces in one core** (scaffolder + widget + MCP).

## Strategic warnings (drawn from the analysis)

### Warning 1: Don't write the embedded wallet from scratch
AvaCloud WaaS + Web3Auth have solved this, with HSM-backed key management. If we write our own wallet:
- We take on the security risk (catastrophic if done wrong).
- We compete directly with a product that Ava Labs funds (WaaS).

→ **Decision:** Our widget wraps the existing **free** provider (Web3Auth); optionally it offers an AvaCloud WaaS adapter. Our value isn't key management, it's the packaging. (see [ADR-001](04-adr.md))

### Warning 2: Relationship with BuilderKit
`ConnectButton` already exists in BuilderKit. We must do what they don't: **social-login default + scaffold + AI context.**

> **Update (project rule):** UI will be **shadcn/ui only** ([doc 11](11-conventions.md)); BuilderKit UI is **not used**. We build Avalanche-specific components ourselves on top of shadcn. Trade-off: overlap with Ava Labs at the UI level; gain: a single design language + full control (black/white, theme-first) + AI ergonomics. Alignment is sustained at the *infrastructure* level (wallet/SDK) rather than at UI.

### Warning 3: Don't overlap with the official MCP/docs
The official MCP does docs retrieval. We offer **action** tools (scaffold/deploy/wire), not docs, and we *consume* the official `llms.txt`. Complementary, not overlapping.

## Evidence level for the "not yet built" claim

- **Strong evidence:** An existing provider was found for each individual piece; no single product was found that offers the open-source + unified + AI-native intersection.
- **Uncertainty:** A very new / lightly announced community project could have been missed. A final quick scan before M1 is recommended (npm `create-avalanche-*`, GitHub `avalanche` + `scaffold`/`mcp` topics).

## Sources

- https://github.com/ava-labs/avalanche-starter-kit
- https://github.com/ava-labs/builderkit
- https://github.com/ava-labs/avalanche-sdk-typescript
- https://docs.avacloud.io/wallet-as-a-service/getting-started/overview
- https://avacloud.io/blog/avacloud-wallet-as-a-service
- https://docs.metamask.io/embedded-wallets/connect-blockchain/evm/avalanche/
- https://github.com/utkucy/avalanche-mcp-tools
- https://build.avax.network/docs/tooling/ai-llm/mcp-server
- https://cubist.dev/blog/cubist-partners-with-ava-labs-to-power-core-seedless-wallet
- https://github.com/alchemyplatform/create-web3-dapp
