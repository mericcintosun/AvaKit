# __PROJECT_NAME__ — Confidential token (eERC) dapp (scaffolded with AvaKit)

Operational guide for AI agents (Claude Code / Cursor) working in this project.

## Stack

Next.js 16 (App Router) · React 19 · `@avakit/react` · `@avakit/core` · `@avalabs/eerc-sdk` · wagmi · viem · shadcn/ui · next-themes

## What this is

A demo of Avalanche's **Encrypted ERC (eERC)** standard: token balances and transfer amounts are
hidden using zero-knowledge proofs (Groth16) and ElGamal encryption over BabyJubJub, while the
recipient/sender addresses stay public on-chain. This template points at a **shared, pre-deployed
standalone eERC instance on Fuji** (`lib/eerc-config.ts`) — there is no `contracts/` directory and
no browser-deploy step, unlike AvaKit's other templates.

## Why this template deviates from the others

- **No bundled contracts.** eERC's contracts depend on real cryptographic primitives (Poseidon
  hashing, a BabyJubJub library, four separate Groth16 verifiers) generated from circuits — not the
  "self-contained, zero-dependency Solidity" pattern other AvaKit templates use. Vendoring the
  circuits/contracts would also pull in Ava Labs' Ecosystem License (not MIT) into an MIT repo, so
  this template consumes the official `@avalabs/eerc-sdk` (ISC-licensed) as an npm dependency
  instead of vendoring source.
- **Circuits load from a CDN, not the bundle.** Proof generation (register/mint/transfer/withdraw/burn)
  runs client-side via snarkjs against `.wasm`/`.zkey` circuit files (~2–14 MB each). `lib/eerc-config.ts`
  points at `ava-labs/EncryptedERC`'s committed `circom/build/` directory via jsDelivr's GitHub CDN,
  pinned to a commit hash, so nothing is vendored in this package and nobody has to compile circuits.
- **wagmi is present alongside `@avakit/react`.** `@avalabs/eerc-sdk`'s hooks use `wagmi`'s
  `useReadContract`/`useBlockNumber` internally for balance/state reads. `app/providers.tsx` wraps
  the app in a `WagmiProvider` (config pointed at Fuji) purely to satisfy that — wallet connect and
  signing still go through `AvaKitProvider`'s adapters (Web3Auth / injected); wagmi never owns the
  connected account.
- **Pinned wagmi 2.x, not the newest major.** `@avalabs/eerc-sdk`'s peer dependency is `wagmi: ^2.0.0`;
  a newer wagmi major would violate that contract, so this template intentionally does not follow
  AvaKit's usual "latest stable of everything" rule for this one package.

## Architecture

- `lib/eerc-config.ts` — the deployed `EncryptedERC` contract address (standalone, name "Test",
  symbol "TEST", 2 decimals) and the circuit URLs.
- `scripts/deploy-eerc.mjs` (`pnpm deploy:eerc`) — deploys YOUR OWN standalone instance to Fuji
  (clones the official repo pinned to the circuits' commit, never vendors it) and rewrites
  `EERC_CONTRACT_ADDRESS` to point at it.
- `app/providers.tsx` — `<AvaKitProvider>` (wallet) + `<WagmiProvider>` (eERC SDK internals) + `ThemeProvider`.
- `components/demo.tsx` — register → unlock → (owner: set auditor) → mint → confidential
  transfer → burn. Mint is disabled unless the connected wallet owns the instance and its
  auditor key is set; the owner sees a one-click "Set auditor" step until it is.

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Build viem clients: `getPublicClient(chain)` from `@avakit/core`, and a **wallet client with an
   account attached** — `createWalletClient({ chain, transport: custom(provider), account: address })`.
   (`@avakit/core`'s `getWalletClient` does *not* attach an account; the eERC SDK requires
   `wallet.account.address` to be set, so build the client directly with viem instead.)
3. `useEERC(publicClient, walletClient, EERC_CONTRACT_ADDRESS, circuitURLs)` from `@avalabs/eerc-sdk`.
4. **Register** (one-time, on-chain): `eerc.register()`. Generates a BabyJubJub keypair from a wallet
   signature and calls `Registrar.register()` with a ZK proof. Idempotent — safe to call again.
5. **Unlock** (per session, off-chain): `eerc.generateDecryptionKey()`. Re-derives the same
   deterministic decryption key from a signature so the browser can decrypt your balance. No gas.
6. `const balance = eerc.useEncryptedBalance()` → `privateMint`, `privateTransfer`, `privateBurn`,
   `decryptedBalance`, `parsedDecryptedBalance`, `refetchBalance`.
7. **Mint** — `balance.privateMint(recipient, amountInBaseUnits)`. **Owner-only on-chain**
   (`EncryptedERC.privateMint` is `onlyOwner` by design, for compliance) — only the wallet that
   deployed the contract can mint. Run `pnpm deploy:eerc` to get your own instance, connect the
   deployer wallet, and the UI walks you through the auditor step; the demo reads
   `eerc.owner` / `eerc.isAuditorKeySet` and gates the Mint button accordingly.
8. **Transfer** — `balance.privateTransfer(to, amountInBaseUnits)`. Permissionless for any two
   *registered* accounts; amounts and balances stay encrypted on-chain.
9. **Burn** — `balance.privateBurn(amountInBaseUnits)`. Permissionless, standalone-mode only.

There is no `withdraw`/`deposit` step in this demo — those convert to/from an underlying public
ERC-20 in eERC's **converter mode**; this template deploys **standalone mode** (the token only
exists in encrypted form).

## Deploying your own instance

The shared demo contract has no auditor key requirements you control and mint is owner-gated.
One command replaces the old five manual steps:

```bash
DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:eerc
```

Use a throwaway key funded with Fuji test AVAX. The script clones the official
`ava-labs/EncryptedERC` repo into `~/.avakit/` — **pinned to the same commit the circuit CDN URLs
use**, so contracts and circuits can never drift apart — compiles it, deploys verifiers +
Registrar + standalone `EncryptedERC` to Fuji, and rewrites `EERC_CONTRACT_ADDRESS` in
`lib/eerc-config.ts` to your new instance. The key is read from the environment at hardhat
runtime; it is never written to disk or passed on a command line. (The contracts are not vendored
in this repo on purpose: they are under Ava Labs' Ecosystem License, not MIT.)

Then in the app, connect the **deployer** wallet: Register → **Set auditor** (the UI shows this
one-click owner step until the key is set — an auditor must be registered *and* set before any
mint/transfer/burn succeeds) → Mint.

## Rules

- shadcn/ui only; `@avakit/react` components are shadcn-styled; plain Tailwind-styled `<input>` for
  amount/address fields (no separate shadcn Input component is bundled by `@avakit/react`).
- Black & white only for now; dark/light via next-themes; both must work.
- Animations: Framer Motion or GSAP only.
- Amounts are in the token's base units (2 decimals here) — always convert with `parseUnits` /
  `formatUnits`, read `decimals` from `balance.decimals` rather than hardcoding it.
- Never hardcode private keys; wallet signing always goes through the connected adapter.
- Default chain is Fuji testnet; mainnet requires explicit opt-in.
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `pnpm dev` — dev server (http://localhost:3000 by default)
- `pnpm build` — production build
