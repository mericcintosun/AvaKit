# 00 — Vision & Positioning

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

## In one sentence

> **AvaKit is Avalanche's open-source, AI-native `create-next-app`:** with a single command it produces a deploy-ready dapp with social-login onboarding and built-in agent context — and it does this by wrapping existing pieces rather than rewriting them.

## Context: where did this idea come from?

Three signals emerged from a conversation with the Avalanche TR dev lead:

1. **Onboarding friction** (seed words) — *but this is already solved.* Core Wallet has supported seedless login (Google/Apple) via Cubist/CubeSigner since December 2023. So the friction on the **end-user** side is already closed.
2. **EVM compatibility** — because Avalanche C-Chain is EVM, Ethereum tooling largely works; this is an advantage.
3. **"The dev tool is missing + it should be vibe-coder friendly"** — the thing the dev lead called a "very good hint," and where the **real gap** is.

## The critical insight

The unsolved problem isn't onboarding — it's **the developer setting up an application that uses that onboarding.**

Core's seedless flow exists for the end user. But when a new or AI-assisted developer says "let me stand up a social-login, deployable Avalanche dapp in 5 minutes," they have **no** ready-made, working, batteries-included starting point. They wire everything by hand.

**The friction isn't with the end user, it's with the dev. AvaKit targets developer friction.**

## What we are not doing (anti-scope)

- **We are not writing our own wallet / key management.** Web3Auth and AvaCloud WaaS (Cubist-backed, HSM-backed) have solved this. Rewriting it means both a security risk and competing with a product that Ava Labs funds.
- **We are not inventing a new UI component library.** We adopt **shadcn/ui**; we build Avalanche-specific components (connect, chain selector) on top of its primitives. (BuilderKit UI is not used — see [Conventions](11-conventions.md).)
- **We are not writing a new chain SDK.** We use the viem/wagmi + `avalanche-sdk-typescript` layer.

## Positioning matrix

| Axis | Where AvaKit sits |
|---|---|
| Open source vs closed | **Open source (MIT)** — AvaCloud WaaS is closed/paid; this is our differentiator |
| Education vs production | **Production-ready** — the official starter-kit is education/cross-chain-demo focused |
| Human-first vs AI-native | **AI-native by default** — every generated app ships with agent context |
| Single-piece vs unified | **Unified** — scaffolder + widget + MCP in one core |

## Value proposition, by audience

### Vibe coder (doesn't know blockchain, codes with Cursor/Claude)
- Runs `npx create-avalanche-app`, or tells Claude "set up an Avalanche dapp" → MCP handles it.
- Zero config, a working social-login dapp. No worrying about seed phrases, RPC URLs, or faucets.

### EVM / Solidity dev (coming from Ethereum)
- Sees a familiar stack underneath: viem/wagmi + Foundry + Next.js.
- Drops the `<ConnectAvalanche>` widget into their existing project.
- No vendor lock-in; can switch to their own wallet provider at any time.

## What does success look like? (north star)

> The time from a developer thinking "let me try something on Avalanche" to a working dapp where they log in with Google in the browser and send their first transaction on testnet is **< 5 minutes.**

## Naming

- Product/umbrella: **AvaKit**
- Packages: `@avakit/core`, `@avakit/react`, `@avakit/mcp`
- CLI: `create-avalanche-app` (`npm create avalanche-app@latest`)

For detailed personas, goals, and metrics: [PRD](01-prd.md).
