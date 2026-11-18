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
- `lib/deployed-contract.ts` — `useDeployedContract(name, chain)`: remembers the pass contract this
  browser deployed (in `localStorage`, per chain) so a reload keeps the gate pointed at it, and only
  hands the address to the UI after `eth_getCode` confirms bytecode. `remember(address)` after a
  deploy; `forget()` returns to the deploy step.
- `app/providers.tsx` — `<AvaKitProvider>` + `ThemeProvider`.

## The gate

```ts
// In the component body — hooks are never called inside a callback or after an await.
const { address } = useAvaAccount(); // the visitor
const { read } = useContract({ address: passAddress, abi }); // the access-pass contract

// In an effect or handler:
const balance = (await read("balanceOf", [address])) as bigint;
const hasAccess = balance > 0n; // render gated content only when true
```

`passAddress` is the pass contract and `address` the visitor — two different things.

A balance that is still loading, or whose read failed, is **unknown** — never "no pass".
`components/demo.tsx` keeps a `Gate` state for that (`checking` | `error` | `ready` with the balance):

- it goes back to `checking` whenever the account or the contract changes, so one holder's access
  never carries over to the next wallet;
- a failed read becomes `error` (with a "Try again" button), not the locked view with a mint prompt;
- answers that arrive for a previous account are ignored.

Keep those three properties when you change the gate.

- Deploy: `useAvaDeploy().deploy({ abi, bytecode })`
- Mint a pass: `write("mint", [])` (from the same `useContract({ address: passAddress, abi })`)

In this demo the pass contract is whichever one **this browser** deployed (`useDeployedContract`), so
every visitor starts by deploying their own. For a real app, deploy the pass once and use that fixed
address for everyone: replace `useDeployedContract(...)` in `components/demo.tsx` with a constant
(or an env var) and drop the deploy step.

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
