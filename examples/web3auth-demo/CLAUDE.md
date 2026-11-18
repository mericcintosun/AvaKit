# examples/web3auth-demo — Avalanche NFT dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (contract)

## Architecture

- `contracts/src/AvaKitNFT.sol` — a minimal, self-contained ERC-721 mint contract
- `lib/nft-artifact.ts` — the compiled ABI + bytecode (so the app deploys from the browser with no Foundry at runtime)
- `app/providers.tsx` — `<AvaKitProvider>` (chains + wallet adapters) + `ThemeProvider`
- `components/demo.tsx` — deploy the contract, then mint

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Deploy: `useAvaDeploy().deploy({ abi, bytecode })` → returns the contract address.
3. Mint: `useContract({ address, abi }).write("mint", [])`.
4. Read state: `useContract(...).read("totalSupply")`, `.read("balanceOf", [address])`.

## Editing the contract

The bundled `lib/nft-artifact.ts` is generated from the Solidity source. After changing `contracts/src/AvaKitNFT.sol`, regenerate it (needs Foundry):

```bash
# from the repository root
cd contracts-ci && node scripts/check-artifacts.mjs --write
```

The script rebuilds the contract with the repository's pinned compiler settings and rewrites the ABI and bytecode in `lib/nft-artifact.ts` in place. Never edit that file or copy the values over by hand: CI runs the same script without `--write` and fails when the artifact no longer matches the source.

## Rules

- UI uses **shadcn/ui only** (components from `@avakit/react` are shadcn-styled).
- **Black & white only** for now; dark/light via `next-themes`. Add brand colors later in `app/globals.css`.
- Animations: **Framer Motion** or **GSAP** only.
- Never hardcode secrets; private keys live in the wallet provider.
- Deploying/minting costs gas — fund the wallet on Fuji first (in-app faucet link).
- Social login needs `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` in `.env.local` (free, dashboard.web3auth.io).

## Commands

- `pnpm dev` — dev server (http://localhost:3000)
- `pnpm build` — production build
- `cd contracts && forge build` — compile the contract (a quick check that it still builds)
- `cd contracts-ci && node scripts/check-artifacts.mjs --write` (from the repository root) — regenerate `lib/nft-artifact.ts` from the contract source
