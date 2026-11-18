# __PROJECT_NAME__ — Avalanche dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes

## Architecture

- `app/providers.tsx` — `<AvaKitProvider>` (chains + wallet adapters) + `ThemeProvider`
- `app/layout.tsx` — root layout, fonts, providers
- `components/demo.tsx` — wallet connect + balance + a sample transaction
- Wallet/chain config lives in `app/providers.tsx`

## Chain and wallets

This app runs on `__CHAIN_CONST__` from `@avakit/core/chains` (`fuji` = Avalanche Fuji testnet,
`cChain` = Avalanche C-Chain mainnet). `app/providers.tsx` derives the wallet setup from it:

- **Testnet:** a temporary in-browser (burner) wallet, social login on Web3Auth's Sapphire Devnet
  (a bundled demo client ID makes it work on localhost), and injected wallets (Core / MetaMask).
- **Mainnet:** no burner wallet (its key sits in `localStorage` in the clear), social login on
  Web3Auth's Sapphire Mainnet with **your own** `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (the option is
  listed but disabled until it is set — the demo client ID is never used), and injected wallets.
  Every transaction spends real AVAX.

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
- On a testnet, social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io, Sapphire Devnet) in `.env.local` before deploying — the demo key only allows localhost. On mainnet there is no demo fallback: social login needs your own Sapphire Mainnet client ID (see "Chain and wallets").

## Commands

- `pnpm dev` — start the dev server (http://localhost:3000 by default)
- `pnpm build` — production build
- `pnpm typecheck` — TypeScript check
