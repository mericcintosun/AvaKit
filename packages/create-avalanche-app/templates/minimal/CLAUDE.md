# __PROJECT_NAME__ — Avalanche dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes

## Architecture

- `app/providers.tsx` — `<AvaKitProvider>` (chains + wallet adapters) + `ThemeProvider`
- `app/layout.tsx` — root layout, fonts, providers
- `components/demo.tsx` — wallet connect + balance + a sample transaction
- `components/funding.tsx` — `useFunding()` + `<FundingNotice />`: polls the balance while the
  wallet is empty and follows `useFaucet()`. Shows "Getting test AVAX…" while the faucet works,
  nothing noisy once funded, and on a refusal the faucet's message, a "Try again" button and the
  official faucet. Buttons that send a transaction are disabled only while `funding.isEmpty` (the
  balance was read and is zero) — an unknown balance is not an empty one.
- Wallet/chain config lives in `app/providers.tsx`

## Chain and wallets

This app runs on `__CHAIN_CONST__` from `@avakit/core/chains` (`fuji` = Avalanche Fuji testnet,
`cChain` = Avalanche C-Chain mainnet). `app/providers.tsx` derives the wallet setup from it:

- **Testnet:** a temporary in-browser (burner) wallet, social login on Web3Auth's Sapphire Devnet
  (a bundled demo client ID makes it work on localhost), and injected wallets (Core / MetaMask).
- **Mainnet:** no burner wallet (its key sits in `localStorage` in the clear), social login on
  Web3Auth's Sapphire Mainnet with **your own** `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (the option is
  listed but disabled until it is set — the demo client ID is never used), and injected wallets.
  Every transaction spends real AVAX, and no faucet is ever asked.

## Test AVAX (faucet)

A new wallet holds nothing, so on Fuji `app/providers.tsx` passes a `faucetUrl` to
`<AvaKitProvider>`: the provider funds the temporary (burner) wallet by itself when it connects with
an empty balance, and `useFaucet().fund()` funds any other wallet on request. The default is
AvaKit's shared Fuji faucet (`AVAKIT_FAUCET_URL` from `@avakit/core`) — rate-limited (one small drip
per address per day, plus an hourly cap per IP address), paid for by the AvaKit maintainer, and
meant for first runs only, never for a product. Set `NEXT_PUBLIC_AVAKIT_FAUCET_URL` to your own
faucet's `/fund` URL (the Worker and its guide are in `services/faucet` of the AvaKit repository)
or to `off` to ask no faucet. The URL is only ever passed on Fuji (chain id 43113) — keep it that
way: a mainnet app must never ask a faucet for funds. When the faucet refuses, the fallback is the
official faucet (needs a free Builder Hub sign-in).

Two things to keep when you change this:

- **Do not call `fund()` on mount.** The provider already asks for the temporary wallet, and
  `useFaucet()` reports that request (`status`: `idle` → `funding` → `success` or `error`). A second
  request for the same address is refused as "funded recently" and would show an error on a page
  that is fine. `fund()` is for a button: "Get test AVAX" for another empty wallet, "Try again"
  after an error.
- **`status: "success"` means the faucet sent the transaction, not that it has arrived.** Keep
  reading the balance until it is non-zero before enabling anything that costs gas —
  `useFunding()` does this.

## Common tasks

- **Wallet button:** `<ConnectAvalanche />` (from `@avakit/react`)
- **Account:** `useAvaAccount()` → `{ address, isConnected }`
- **Balance:** `useBalance()` → `{ data, isLoading, error, refetch }` (`data` is `null` until it has been read)
- **Test AVAX:** `useFaucet()` → `{ fund, status, error, isFunding, enabled }`; `useFunding()` in `components/funding.tsx` combines it with the balance
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
