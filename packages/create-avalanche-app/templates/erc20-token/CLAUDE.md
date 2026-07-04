# __PROJECT_NAME__ — Avalanche ERC-20 dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor).

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (token contract)

## Architecture

- `contracts/src/AvaKitToken.sol` — a minimal, self-contained ERC-20 (name AKT, 18 decimals) with a public `mint()` demo faucet.
- `lib/token-artifact.ts` — the compiled ABI + bytecode (browser deploy, no Foundry at runtime).
- `components/demo.tsx` — deploy → mint → transfer.
- `app/providers.tsx` — `<AvaKitProvider>` + `ThemeProvider`.

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Deploy: `useAvaDeploy().deploy({ abi, bytecode })`.
3. Mint: `useContract({ address, abi }).write("mint", [])` (mints 100 AKT).
4. Transfer: `.write("transfer", [to, parseUnits("10", 18)])`.
5. Read: `.read("balanceOf", [address])`, `.read("totalSupply")` — format with `formatUnits(v, 18)`.

## Editing the contract

After changing `contracts/src/AvaKitToken.sol`:

```bash
cd contracts && forge build
# copy out/AvaKitToken.sol/AvaKitToken.json's abi + bytecode.object into lib/token-artifact.ts
```

## Rules

- shadcn/ui only; `@avakit/react` components are shadcn-styled.
- Black & white only for now; dark/light via next-themes; both must work.
- Animations: Framer Motion or GSAP only.
- Amounts are in wei — always convert with `parseUnits` / `formatUnits` (18 decimals).
- Deploying, minting, and transferring cost gas — fund the wallet on Fuji first.
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — dev server
- `cd contracts && forge build` — recompile the token
