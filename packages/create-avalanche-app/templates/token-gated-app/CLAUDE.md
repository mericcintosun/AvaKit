# __PROJECT_NAME__ — Token-gated Avalanche dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor).

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (access-pass contract)

## Idea

Content is gated behind ownership of an **access-pass NFT**. If `balanceOf(address) > 0`, the gated section renders; otherwise it stays locked with a mint button.

## Architecture

- `contracts/src/AvaKitNFT.sol` — the access-pass **full ERC-721** (minimal, self-contained).
  The pass is transferable: selling or sending it moves the access with it. If your use case
  needs a non-transferable (soulbound) pass, remove the transfer functions and say so.
- `lib/nft-artifact.ts` — compiled ABI + bytecode (browser deploy, no Foundry at runtime).
- `components/demo.tsx` — deploy pass → mint → gate logic.
- `app/providers.tsx` — `<AvaKitProvider>` + `ThemeProvider`.

## The gate

```ts
const contract = useContract({ address, abi });
const balance = (await contract.read("balanceOf", [address])) as bigint;
const hasAccess = balance > 0n; // render gated content only when true
```

- Deploy: `useAvaDeploy().deploy({ abi, bytecode })`
- Mint a pass: `contract.write("mint", [])`

To gate on a different token (e.g. an existing ERC-20 or NFT), point `useContract` at that address/ABI and adjust the `hasAccess` check (e.g. balance ≥ threshold).

## Rules

- shadcn/ui only; `@avakit/react` components are shadcn-styled.
- Black & white only for now; dark/light via next-themes; both must work.
- Animations: Framer Motion or GSAP only.
- Deploying/minting costs gas — fund the wallet on Fuji first.
- Never gate sensitive data purely client-side: the gated content here is illustrative. For real secrets, verify ownership server-side (e.g. sign-in-with-Ethereum + an API check).
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — dev server
- `cd contracts && forge build` — recompile the access-pass contract
