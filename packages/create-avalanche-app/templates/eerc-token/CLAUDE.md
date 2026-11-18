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
- **Circuits load from a CDN, not the bundle — and are integrity-checked.** Proof generation
  (register/mint/transfer/withdraw/burn) runs client-side via snarkjs against `.wasm`/`.zkey`
  circuit files (~2–14 MB each). `lib/eerc-config.ts` points at `ava-labs/EncryptedERC`'s committed
  `circom/build/` directory via jsDelivr's GitHub CDN, pinned to a commit hash, so nothing is
  vendored in this package and nobody has to compile circuits. Before the SDK ever sees them,
  `loadVerifiedCircuits()` downloads every file, checks it against a pinned SHA-256 (computed from
  the source repo, not the CDN), and hands the SDK `blob:` URLs of the verified bytes — the whole
  privacy model rests on proving against the intended circuits, so a tampered CDN copy fails
  loudly instead of proving quietly.
- **wagmi is present alongside `@avakit/react`.** `@avalabs/eerc-sdk`'s hooks use `wagmi`'s
  `useReadContract`/`useBlockNumber` internally for balance/state reads. `app/providers.tsx` wraps
  the app in a `WagmiProvider` (config pointed at Fuji) purely to satisfy that — wallet connect and
  signing still go through `AvaKitProvider`'s adapters (Web3Auth / injected); wagmi never owns the
  connected account.
- **Pinned wagmi 2.x, not the newest major.** `@avalabs/eerc-sdk`'s peer dependency is `wagmi: ^2.0.0`;
  a newer wagmi major would violate that contract, so this template intentionally does not follow
  AvaKit's usual "latest stable of everything" rule for this one package.

## Pinned upstream version

- **Circuits + contracts:** `ava-labs/EncryptedERC` at commit
  `c7eb0e09bc9315e68c35d3c09f5dce4b794d0485` — `CIRCUIT_COMMIT` in `lib/eerc-config.ts` (the circuit
  files the browser proves against, each with a pinned SHA-256) and `COMMIT` in
  `scripts/deploy-eerc.mjs` (the contracts `npm run deploy:eerc` builds). Keep the two equal:
  contracts and circuits have to be the same version.
- **SDK:** `@avalabs/eerc-sdk` `1.0.2` (exact, in `package.json`), with `wagmi` `2.19.5` because
  the SDK peer-depends on `wagmi: ^2.0.0`.
- Upstream merged security fixes with regenerated verifier keys on 2026-08-31 that are not in a tagged release yet; this template has not been moved to them.
  Moving to them means changing both constants together, recomputing all ten SHA-256 hashes from
  the source repository, and deploying a new instance with `npm run deploy:eerc` — never change one
  of these alone.
- **Testnet only:** Avalanche Fuji, and nothing else (see "Fuji only" under Rules). Never point this
  template at a mainnet or put real funds behind it.

## Architecture

- `lib/eerc-config.ts` — `EERC_CONTRACT_ADDRESS`, the `EncryptedERC` instance the app talks to
  (standalone, name "Test", symbol "TEST", 2 decimals; `npm run deploy:eerc` rewrites this line),
  `usesSharedInstance` (true while it still equals `SHARED_EERC_CONTRACT_ADDRESS`), the pinned
  circuit files + SHA-256 hashes, and `loadVerifiedCircuits()` (download → verify → blob URLs,
  done once per page load and shared by every caller; needs https or `http://localhost`, because
  browsers only provide WebCrypto there). A download that fails (offline, an ad blocker or a proxy
  blocking cdn.jsdelivr.net) rejects with `CircuitDownloadError`, which the demo shows with a "Try
  again" button; a file that fails its SHA-256 check rejects with a plain `Error` and gets no retry
  button — keep it that way, a retry must never be a way around the integrity check.
- `scripts/deploy-eerc.mjs` (`npm run deploy:eerc`) — deploys YOUR OWN standalone instance to Fuji
  (clones the official repo pinned to the circuits' commit, never vendors it) and rewrites
  `EERC_CONTRACT_ADDRESS` to point at it.
- `app/providers.tsx` — `<AvaKitProvider>` (wallet) + `<WagmiProvider>` (eERC SDK internals) + `ThemeProvider`.
- `components/demo.tsx` — register → unlock → (owner: set auditor) → mint → confidential
  transfer → burn. Mint is disabled unless the connected wallet owns the instance and its
  auditor key is set; the owner sees a one-click "Set auditor" step until it is.
- `components/funding.tsx` — `useFunding()` + `<FundingNotice />`: polls the balance while the
  wallet is empty and follows `useFaucet()`. Shows "Getting test AVAX…" while the faucet works,
  nothing noisy once funded, and on a refusal the faucet's message, a "Try again" button and the
  official faucet. Buttons that send a transaction are disabled only while `funding.isEmpty` (the
  balance was read and is zero) — an unknown balance is not an empty one.

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

## The flow

1. Connect a wallet (`<ConnectAvalanche />`).
2. Build viem clients: `getPublicClient(chain)` from `@avakit/core`, and a **wallet client with an
   account attached** — `createWalletClient({ chain, transport: custom(provider), account: address })`.
   (`@avakit/core`'s `getWalletClient` does *not* attach an account; the eERC SDK requires
   `wallet.account.address` to be set, so build the client directly with viem instead.)
3. `useEERC(publicClient, walletClient, EERC_CONTRACT_ADDRESS, circuits)` from `@avalabs/eerc-sdk`,
   where `circuits` comes from `await loadVerifiedCircuits()` (the demo loads it on mount and
   shows a "verifying circuits" state until it resolves).
4. **Register** (one-time, on-chain): `eerc.register()`. Generates a BabyJubJub keypair from a wallet
   signature and calls `Registrar.register()` with a ZK proof. Idempotent — safe to call again.
5. **Unlock** (per session, off-chain): `eerc.generateDecryptionKey()`. Re-derives the same
   deterministic decryption key from a signature so the browser can decrypt your balance. No gas.
6. `const balance = eerc.useEncryptedBalance()` → `privateMint`, `privateTransfer`, `privateBurn`,
   `decryptedBalance`, `parsedDecryptedBalance`, `refetchBalance`.
7. **Mint** — `balance.privateMint(recipient, amountInBaseUnits)`. **Owner-only on-chain**
   (`EncryptedERC.privateMint` is `onlyOwner` by design, for compliance) — only the wallet that
   deployed the contract can mint. Run `npm run deploy:eerc` to get your own instance, connect the
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
DEPLOYER_PRIVATE_KEY=0x... npm run deploy:eerc
```

Use a throwaway key funded with Fuji test AVAX — the app's faucet only funds the wallet connected in
the browser, so fund this key from the official faucet (needs a free Builder Hub sign-in:
https://build.avax.network/console/primary-network/faucet). The script clones the official
`ava-labs/EncryptedERC` repo into `~/.avakit/` — **pinned to the same commit the circuit CDN URLs
use**, so contracts and circuits can never drift apart (the cached clone is reused only while
`git rev-parse HEAD` in it equals that commit; anything else is replaced with a fresh clone, and a
checkout that fails leaves no cache behind) — compiles it, deploys verifiers +
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
- **Fuji only.** The shared eERC instance exists only on Fuji and `npm run deploy:eerc` deploys only
  to Fuji, so there is no supported way to run this template on another chain. Changing the chain
  in `app/providers.tsx` alone leaves the app reading an address with no contract behind it; to
  use another chain you would first have to deploy the eERC contracts there yourself with the
  upstream `ava-labs/EncryptedERC` tooling and point `EERC_CONTRACT_ADDRESS` at them.
- Social login works out of the box on localhost via a bundled demo Web3Auth key. Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (free at https://dashboard.web3auth.io) in `.env.local` before deploying — the demo key only allows localhost.

## Commands

- `npm run dev` — dev server (http://localhost:3000 by default)
- `npm run build` — production build
