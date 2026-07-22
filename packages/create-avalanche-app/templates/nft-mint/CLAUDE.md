# __PROJECT_NAME__ — Avalanche NFT dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (contract)

## Architecture

- `contracts/src/AvaKitNFT.sol` — a minimal, self-contained **full ERC-721** (mint + the complete
  transfer/approval surface + ERC-165, with on-chain generative art)
- `lib/nft-artifact.ts` — the compiled ABI + bytecode (so the app deploys from the browser with no Foundry at runtime)
- `app/providers.tsx` — `<AvaKitProvider>` (chains + wallet adapters) + `ThemeProvider`
- `components/demo.tsx` — deploy the contract, then mint

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Deploy: `useAvaDeploy().deploy({ abi, bytecode })` → returns the contract address.
3. Mint: `useContract({ address, abi }).write("mint", [])`.
4. Read state: `useContract(...).read("totalSupply")`, `.read("balanceOf", [address])`.

## Editing the contract

The bundled `lib/nft-artifact.ts` is generated from the Solidity source. After changing `contracts/src/AvaKitNFT.sol`:

```bash
cd contracts && forge build
# then copy out/AvaKitNFT.sol/AvaKitNFT.json's abi + bytecode.object into lib/nft-artifact.ts
```

## Rules

- UI uses **shadcn/ui only** (components from `@avakit/react` are shadcn-styled).
- **Black & white only** for now; dark/light via `next-themes`. Add brand colors later in `app/globals.css`.
- Animations: **Framer Motion** or **GSAP** only.
- Never hardcode secrets; private keys live in the wallet provider.
- Deploying/minting costs gas — fund the wallet on Fuji first (in-app faucet link).
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — dev server (http://localhost:3000 by default)
- `pnpm build` — production build
- `cd contracts && forge build` — recompile the contract
