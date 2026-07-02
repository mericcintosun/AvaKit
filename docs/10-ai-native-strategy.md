# 10 — AI-Native Strategy

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

> This is AvaKit's **main differentiator.** The scaffolder and embedded-wallet pieces can be copied one day; owning the "AI-native by default" position early and clearly creates a defensible advantage. This is the concrete answer to the dev lead's "it should be vibe-coder friendly" hint.

## Principle: context is embedded in the generated artifact

Most projects leave AI support "outside" (a separate docs MCP). AvaKit puts the context **inside every dapp it generates**; so the moment the developer opens Cursor/Claude, the agent already "knows" Avalanche + AvaKit.

## Three layers

### Layer 1 — Context files inside the generated app
`create-avalanche-app` adds to every project:

**`CLAUDE.md`** (an operational guide for the agent)
- Project architecture: which file does what (`app/providers.tsx`, `lib/avakit.ts`, `contracts/`).
- AvaKit API reminders: `<ConnectAvalanche>`, `useAvaAccount`, the deploy helper.
- Common tasks: "add a contract", "new page", "deploy to Fuji", "change the wallet provider".
- **Do-not rules:** "Don't write the private key into code", "Don't deploy to mainnet without confirmation", "Don't hardcode the RPC URL — use env".
- Commands: `pnpm dev`, `pnpm deploy:fuji`, `pnpm typegen`.

**`llms.txt`** (project map, AI-friendly)
- File/directory map + key entry points + external docs links (the official Avalanche `llms.txt`).

**`.cursor/rules/avakit.mdc`**
- The same context for Cursor, in the Cursor rule format.

### Layer 2 — MCP tools (action)
`@avakit/mcp` gives the agent not docs but the **ability to act**: `scaffold_app`, `deploy_contract`, `read_chain`, `get_context`. (see [09](09-spec-mcp.md)). It consumes the official `llms.txt`, it does not rewrite its own docs.

### Layer 3 — AvaKit's own documentation is AI-friendly
- All AvaKit docs are accessible as `.md` + an `llms.txt` index.
- API references are short, copy-pasteable, with "the one correct way" examples (so the agent does not generate the wrong pattern).

## Design rules (for the quality of AI output)
1. **A single canonical path.** Let there be only one recommended way to do a given task; don't let the agent drift between alternatives. (e.g. always `<ConnectAvalanche>`, no manual Web3Auth setup.)
2. **Types are the contract.** End-to-end TS + ABI typegen → the code the agent produces is verified at compile time.
3. **Actionable errors.** The error message tells the next step (faucet link, missing env). Let the agent fix itself.
4. **Safe defaults apply on the machine too.** chain=fuji, mainnet explicit+confirm — the agent cannot accidentally deploy to mainnet.
5. **Side-effect transparency.** The scaffolder/MCP dumps which file it wrote; the agent and the human see what happened.

## `CLAUDE.md` template skeleton (for the generated app)
```md
# <ProjectName> — Avalanche dapp (generated with AvaKit)

## Stack
Next.js 16 (App Router) · React 19 · @avakit/react · @avakit/core · wagmi/viem · shadcn/ui · next-themes · Foundry
(UI: shadcn-only, black & white until M3, dark/light from day one, animations via Framer Motion)

## Architecture
- app/providers.tsx — <AvaKitProvider> (wallet + chain config)
- lib/avakit.ts — chain and adapter
- contracts/ — Foundry; out/ artifacts

## Common tasks
- Wallet button: `<ConnectAvalanche />`
- Account: `useAvaAccount()`; Balance: `useBalance()`
- Deploy (testnet): `pnpm deploy:fuji`

## Rules
- Don't write the private key / secret into code; use .env.
- Mainnet deploy: confirmation + balance check first.
- New contract → run `pnpm typegen`.
```

## Success measure
- When a new dev opens Cursor/Claude, without knowing AvaKit at all, the agent produces working, correctly-patterned code on the first try.
- With the MCP, the end-to-end "scaffold → deploy → running dev" is completed in natural language.

Related: [Scaffolder](08-spec-scaffolder.md) · [MCP](09-spec-mcp.md) · [Vision](00-vision-and-positioning.md)
