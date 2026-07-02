# 03 — Architecture

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

## Core principle: 1 core, 3 surfaces

AvaKit is not three separate products; it is **three different consumption surfaces of a single core (`@avakit/core`).** If you do something well in the core, all three surfaces improve at once.

```
                  ┌──────────────────────────────────────┐
                  │           @avakit/core               │  ← KERNEL
                  │  • chain registry (Fuji/C-Chain/L1)  │
                  │  • viem public/wallet client         │
                  │  • WalletAdapter interface           │
                  │      └─ Web3AuthAdapter (default)    │
                  │      └─ AvaCloudAdapter (opt-in)     │
                  │      └─ InjectedAdapter (Core/MM)    │
                  │  • deploy & contract helpers         │
                  │  • chain data reads (RPC/Glacier)    │
                  └───────────────┬──────────────────────┘
                                  │ everyone consumes this
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                           ▼
┌────────────────┐      ┌───────────────────┐       ┌────────────────────┐
│ @avakit/react  │      │ create-avalanche- │       │   @avakit/mcp      │
│ <AvaKitProvider>│     │ app (CLI)         │       │  MCP server        │
│ <ConnectAva.../>│     │ • interactive wiz │       │  • scaffold_app    │
│ hooks (useAva*) │     │ • template render │       │  • deploy_contract │
│ shadcn/ui UI    │     │ • AI context inj. │       │  • read_chain      │
└────────┬───────┘      └─────────┬─────────┘       │  • get_context     │
         │                        │                  └─────────┬──────────┘
         │ into the generated app │ templates                │ calls
         └────────────────────────┴──────────────────────────┘
                          (the scaffolder produces a working Next.js app
                           containing @avakit/react + core; MCP wraps
                           the same scaffolder as a tool)
```

## Surface responsibilities

### `@avakit/core` (kernel)
- **Chain registry:** Fuji, C-Chain mainnet, custom L1 definitions (chainId, RPC, explorer, faucet).
- **Client factory:** viem `publicClient` / `walletClient` creation.
- **WalletAdapter interface:** `connect()`, `disconnect()`, `getAddress()`, `signTransaction()`, etc. Abstracts the provider.
- **Deploy helpers:** read bytecode/ABI from a Foundry artifact and deploy; wait for tx; return address.
- **Data:** balance, tx, contract read (RPC; optional Glacier/AvaCloud data API).
- Framework-agnostic, TypeScript only. Not dependent on React.

### `@avakit/react` (widget layer)
- `<AvaKitProvider>`: wagmi/viem config + puts the selected WalletAdapter into context.
- `<ConnectAvalanche>`: social-login default Connect button (Web3Auth modal), account/chain indicator when connected.
- Hooks: `useAvaAccount()`, `useAvaChain()`, `useAvaDeploy()`, `useContract()`.
- All UI is built on top of **shadcn/ui** primitives (single UI lib); dark/light via `next-themes`, black/white until M3. BuilderKit UI is not used (see [Conventions](11-conventions.md)).

### `create-avalanche-app` (scaffolder)
- Interactive CLI (template, wallet provider, chain selection).
- Template render + dependency installation + `.env.example` generation.
- **AI context injection:** adds `CLAUDE.md`, `llms.txt`, `.cursor/rules` to the generated project.
- Produces a working Next.js app that uses `@avakit/react` + `@avakit/core`.

### `@avakit/mcp` (AI surface)
- MCP server (stdio). Connects to Claude Code / Cursor / Claude Desktop.
- Tools wrap the scaffolder + core: `scaffold_app`, `deploy_contract`, `read_chain`, `get_context`.
- Provides documentation context by consuming the official `llms.txt` (does not write its own docs).

## Monorepo structure

```
avakit/  (repo)
├── apps/
│   └── docs/                 # documentation site (later)
├── packages/
│   ├── core/                 # @avakit/core
│   ├── react/                # @avakit/react
│   ├── mcp/                  # @avakit/mcp
│   └── create-avalanche-app/ # CLI
├── templates/
│   ├── minimal/
│   ├── token-gated-app/
│   └── nft-mint/
├── examples/                 # live demo dapps
└── docs/                     # these planning documents (the current repo)
```

- **Monorepo tool:** pnpm workspaces + Turborepo (see [ADR-002](04-adr.md)).
- **Versioning:** Changesets.
- **Build:** tsup (packages), Next.js (templates/examples).

## Data flow: "first tx with social login"

```
User  →  <ConnectAvalanche>  →  Web3AuthAdapter.connect()
                                          │  (Google OAuth → HSM-backed key)
                                          ▼
                                   viem walletClient  ←  @avakit/core
                                          │
                                          ▼
                                   Fuji RPC  →  tx sent  →  explorer link
```
The private key never passes through AvaKit code; the adapter only uses the signing interface.

## Dependency direction (strict rule)

```
core  ──(not dependent)──>  no surface
react ────────────────────>  core
cli   ────────────────────>  core, react (via templates)
mcp   ────────────────────>  core, cli (for scaffolding)
```
The core cannot depend on any surface. Circular dependencies are forbidden.

## Extension points

- **New wallet provider:** implement `WalletAdapter`, add it to the registry. (Privy, Dynamic, Turnkey...)
- **New template:** a folder + manifest under `templates/`. The CLI and MCP see it automatically.
- **New chain/L1:** an entry in the chain registry. For a custom L1, the user can add it at runtime.
- **New MCP tool:** a tool definition inside `@avakit/mcp`; it calls core/cli.

Related: [ADR](04-adr.md) · [Core Spec](06-spec-core-sdk.md) · [Widget Spec](07-spec-wallet-widget.md) · [Scaffolder Spec](08-spec-scaffolder.md) · [MCP Spec](09-spec-mcp.md)
