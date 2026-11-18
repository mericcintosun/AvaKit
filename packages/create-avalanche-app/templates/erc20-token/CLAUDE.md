# __PROJECT_NAME__ — Avalanche ERC-20 dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor).

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · next-themes · Foundry (token contract)

## Architecture

- `contracts/src/AvaKitToken.sol` — a minimal, self-contained ERC-20 (name "AvaKit Token", symbol `AKT`, 18 decimals) with a public `mint()` demo faucet.
- `lib/token-artifact.ts` — the compiled ABI + bytecode (browser deploy, no Foundry at runtime).
- `components/demo.tsx` — deploy → mint → transfer.
- `components/funding.tsx` — `useFunding()` + `<FundingNotice />`: polls the balance while the
  wallet is empty and follows `useFaucet()`. Shows "Getting test AVAX…" while the faucet works,
  nothing noisy once funded, and on a refusal the faucet's message, a "Try again" button and the
  official faucet. Buttons that send a transaction are disabled only while `funding.isEmpty` (the
  balance was read and is zero) — an unknown balance is not an empty one.
- `lib/deployed-contract.ts` — `useDeployedContract(name, chain)`: remembers the token this browser
  deployed (in `localStorage`, per chain) so a reload does not ask for a second deploy, and only
  hands the address to the UI after `eth_getCode` confirms bytecode. `remember(address)` after a
  deploy; `forget()` returns to the deploy step.
- `app/providers.tsx` — `<AvaKitProvider>` + `ThemeProvider`.

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Deploy: `useAvaDeploy().deploy({ abi, bytecode })`, then keep the address with
   `useDeployedContract(...).remember(address)`.
3. Mint: `useContract({ address, abi }).write("mint", [])` (mints 100 AKT).
4. Transfer: `.write("transfer", [to, parseUnits("10", 18)])`.
5. Read: `.read("balanceOf", [address])`, `.read("totalSupply")` — format with `formatUnits(v, 18)`.

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
- Deploying, minting, and transferring cost gas — a new wallet is funded by the faucet (see "Test AVAX"); keep those buttons disabled while `funding.isEmpty`.
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — dev server
- `cd contracts && forge build` — recompile the token
