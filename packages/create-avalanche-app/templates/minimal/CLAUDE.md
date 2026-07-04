# __PROJECT_NAME__ — Avalanche dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes

## Architecture

- `app/providers.tsx` — `<AvaKitProvider>` (chains + wallet adapters) + `ThemeProvider`
- `app/layout.tsx` — root layout, fonts, providers
- `components/demo.tsx` — wallet connect + balance + a sample transaction
- Wallet/chain config lives in `app/providers.tsx`

## Common tasks

- **Wallet button:** `<ConnectAvalanche />` (from `@avakit/react`)
- **Account:** `useAvaAccount()` → `{ address, isConnected }`
- **Balance:** `useBalance()` → `{ data, isLoading, refetch }`
- **Active chain:** `useAvaChain()` → `{ chain, chains, setChain }`
- **Contract read/write:** `useContract({ address, abi })`
- **Send a tx:** build a viem wallet client with `getWalletClient(chain, provider)` (provider from `useAvaKit()`)

## Rules

- UI uses **shadcn/ui only**. Components from `@avakit/react` are shadcn-styled; keep that consistency.
- **Black & white only** for now; dark/light is wired via `next-themes`. Don't add brand colors yet — edit the tokens in `app/globals.css` when you do.
- Animations: **Framer Motion** or **GSAP** only.
- Never hardcode RPC URLs or secrets; use the chain config and `.env.local`.
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — start the dev server (http://localhost:3000 by default)
- `pnpm build` — production build
- `pnpm typecheck` — TypeScript check
