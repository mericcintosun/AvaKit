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
- `components/funding.tsx` — `useFunding()` + `<FundingNotice />`: polls the balance while the
  wallet is empty and follows `useFaucet()`. Shows "Getting test AVAX…" while the faucet works,
  nothing noisy once funded, and on a refusal the faucet's message, a "Try again" button and the
  official faucet. Buttons that send a transaction are disabled only while `funding.isEmpty` (the
  balance was read and is zero) — an unknown balance is not an empty one.
- `lib/deployed-contract.ts` — `useDeployedContract(name, chain)`: remembers the contract this
  browser deployed (in `localStorage`, per chain) so a reload does not ask for a second deploy, and
  only hands the address to the UI after `eth_getCode` confirms bytecode. `remember(address)` after
  a deploy; `forget()` returns to the deploy step.

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Deploy: `useAvaDeploy().deploy({ abi, bytecode })` → returns the contract address, which the demo
   keeps with `useDeployedContract(...).remember(address)`.
3. Mint: `useContract({ address, abi }).write("mint", [])`.
4. Read state: `useContract(...).read("totalSupply")`, `.read("balanceOf", [address])`.

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
- Deploying/minting costs gas — a new wallet is funded by the faucet (see "Test AVAX"); keep both buttons disabled while `funding.isEmpty`.
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — dev server (http://localhost:3000 by default)
- `pnpm build` — production build
- `cd contracts && forge build` — recompile the contract
