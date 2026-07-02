# 01 — Product Requirements Document (PRD)

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

**Product:** AvaKit
**Status:** Draft v1 (planning)
**Last updated:** 2026-07-01
**Owner:** —

---

## 1. Problem statement

Even though Avalanche C-Chain is EVM-compatible and end-user onboarding (seedless/social login) has been solved by Core and Cubist, **it is still hard for a new or AI-assisted developer to get started with a modern, onboarding-ready dapp on Avalanche.**

Today a developer has to wire the following together by hand:
- RPC URLs, chain IDs, faucet (Fuji testnet)
- Embedded/social-login wallet integration (provider choice, key management, env config)
- Frontend scaffold (Next.js + wagmi + viem + UI)
- Smart contract tooling (Foundry/Hardhat) + deploy scripts
- Making all of these work together

The result: the distance between "let me try Avalanche" and "a working first transaction" is hours/days. For "vibe coders" working with AI tools (Claude Code, Cursor), it's even harder because of the missing chain-specific context.

## 2. Goals & non-goals

### Goals
- G1: Stand up a working, social-login, deployable Avalanche dapp from scratch in **< 5 minutes.**
- G2: Let an EVM dev add a social-login wallet to their **existing** dapp with a **single component.**
- G3: Provide **MCP** + **agent context** so AI coding tools (Claude/Cursor) can scaffold + deploy on Avalanche.
- G4: Be a fully **open-source (MIT)** alternative with a **free default** and no vendor lock-in.

### Non-goals (anti-goals)
- A1: Writing our own key management / wallet infrastructure. (Web3Auth/AvaCloud are wrapped.)
- A2: Creating a new UI component library. (shadcn/ui is adopted; components are built on top of it.)
- A3: Rewriting subnet/L1 launch tooling. (Avalanche CLI / `avalanche-cli` already exists; MCP can call it but we don't rewrite it.)
- A4: Offering a custodial / backend wallet service.

## 3. Personas

### P1 — "Vibe coder" Vera
- Web2/JS background, unfamiliar with blockchain. Develops with Cursor + Claude.
- Need: "Just make it work." Doesn't want to deal with concepts like seed phrases, RPC, or faucets.
- AvaKit entry point: `create-avalanche-app` + MCP. Says, in natural language, "set up an Avalanche dapp with social login."

### P2 — "EVM dev" Emir
- Experienced with Ethereum/Solidity. Knows Foundry, viem, wagmi. Just moving to Avalanche.
- Need: A familiar stack, no vendor lock-in, drop-in integration into an existing project.
- AvaKit entry point: `@avakit/react` widget + `@avakit/core` SDK.

### P3 — "Ecosystem advocate" (secondary)
- Avalanche DevRel / TR community leader. Looking for a fast start for workshops, hackathons, demos.
- Need: Getting people to a working dapp in 5 minutes with a single repo.
- AvaKit entry point: Template gallery + documented onboarding.

## 4. User journeys

### J1 — Vibe coder, from scratch (MCP)
1. In Claude Code: "Set up a token-gated chat dapp on Avalanche, with Google login."
2. MCP calls the `scaffold_app` tool → project is created.
3. MCP deploys to Fuji with `dev` and `deploy_contract`.
4. Log in with Google in the browser → first tx. **< 5 min.**

### J2 — Vibe coder, from scratch (CLI)
1. `npm create avalanche-app@latest`
2. Interactive questions: template, wallet provider (default Web3Auth), chain (default Fuji).
3. `cd app && pnpm dev` → a working social-login dapp.

### J3 — EVM dev, adding to an existing project
1. `pnpm add @avakit/react @avakit/core`
2. Wrap with `<AvaKitProvider>` and place `<ConnectAvalanche />`.
3. Provider client ID into `.env`. Done.

## 5. Functional requirements

| ID | Requirement | Priority | Milestone |
|---|---|---|---|
| FR-1 | `@avakit/core`: chain config (Fuji/C-Chain/custom L1), viem client, deploy helper | P0 | M1 |
| FR-2 | `@avakit/core`: wallet adapter interface; Web3Auth default impl | P0 | M1 |
| FR-3 | `@avakit/react`: `<AvaKitProvider>` + `<ConnectAvalanche>` social-login widget | P0 | M1 |
| FR-4 | `@avakit/react`: AvaKit components built on shadcn/ui (chain selector, account card) + hooks | P1 | M1 |
| FR-5 | `create-avalanche-app`: interactive scaffolder, ≥2 templates | P0 | M2 |
| FR-6 | Template: Next.js + social login + example contract + Fuji deploy script | P0 | M2 |
| FR-7 | `CLAUDE.md` + `llms.txt` + cursor rules in every template | P0 | M2 |
| FR-8 | `@avakit/mcp`: `scaffold_app`, `deploy_contract`, `read_chain`, `get_context` tools | P0 | M3 |
| FR-9 | AvaCloud WaaS optional wallet adapter | P2 | M3+ |
| FR-10 | Custom L1 support (adding your own chain ID/RPC) | P1 | M2 |

## 6. Non-functional requirements

- NFR-1 (DX): From `create-avalanche-app` to a running dev server in **< 5 min**, zero manual config.
- NFR-2 (Openness): MIT license; all packages public on npm.
- NFR-3 (Portability): Wallet provider is swappable; no lock-in.
- NFR-4 (Security): The private key never passes through AvaKit code; the provider uses an HSM/enclave. No secret is written to the repo or logs.
- NFR-5 (Type-safety): End-to-end TypeScript; type generation for contract ABIs.
- NFR-6 (AI ergonomics): MCP tools are idempotent and return descriptive errors; agent context files are kept up to date.

## 7. Success metrics

| Metric | Target (first 6 months) |
|---|---|
| Time-to-first-tx (from scratch) | < 5 min |
| `create-avalanche-app` weekly npm downloads | growing trend |
| GitHub stars | a signal of community interest |
| MCP installs (Claude/Cursor) | the default tool in DevRel demos |
| Ratio of "it didn't work" issues | low; mostly usage, not config |

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AvaCloud WaaS makes us redundant | High | Open source + free + multi-provider; *support* WaaS, don't compete with it |
| Web3Auth/MetaMask API breakage | Medium | Adapter pattern; abstract the provider behind it |
| Web3Auth/SDK/shadcn breaking change | Medium | Pin versions, adapter/wrapping layer |
| Scope creep (3 products at once) | High | Vertical slice: M1 core+widget first, then expand |
| Ava Labs builds an official equivalent | Medium | Move first + own the AI-native angle; contribute upstream if needed |

## 9. Open questions

- What should the default template set be? (proposal: `minimal`, `token-gated-app`, `nft-mint`)
- Is mainnet deploy in v1 scope, or testnet-first? (proposal: testnet-first, mainnet M3)
- Should MCP wrap `avalanche-cli`, or use its own deploy path? (see [ADR](04-adr.md))

Related: [Vision](00-vision-and-positioning.md) · [Competitive Analysis](02-competitive-landscape.md) · [Roadmap](05-roadmap.md)
