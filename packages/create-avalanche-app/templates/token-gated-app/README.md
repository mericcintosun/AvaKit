# __PROJECT_NAME__

A **token-gated** Avalanche dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Content unlocks for holders of an access-pass NFT — no Foundry required to run it.

## Getting started

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. (social login, optional) add a free Web3Auth client ID
cp .env.example .env.local
#    → https://dashboard.web3auth.io (Sapphire Devnet, EVM)

# 2. run it
npm run dev    # http://localhost:3000 (or the port Next prints)
```

Then: connect a wallet → **Deploy access-pass contract** → **Mint access pass** → the gated content unlocks. Deploying and minting cost gas; a new wallet gets its first test AVAX from a faucet (see [Test AVAX](#test-avax)), and both buttons wait until it has arrived.

The app remembers the pass contract you deployed (in your browser, per chain), so after a reload the gate still checks the same contract. **Deploy a new one** starts over. For a real app, deploy the pass once and point the gate at that fixed address for every visitor (see `CLAUDE.md`).

## Test AVAX

A new wallet is empty, so on Fuji the app asks a faucet for a little test AVAX: by itself for the
temporary wallet ("Start instantly"), with no account or sign-in anywhere, and with a
**Get test AVAX** button for any other wallet that holds none. By default that is AvaKit's shared
Fuji faucet — rate-limited (one small drip per address per day, with an hourly cap per IP address),
paid for by the AvaKit maintainer, and meant for first runs only: do not build a product on it.
When it refuses or is empty, the app shows the faucet's message, a **Try again** button and the
official faucet (needs a free Builder Hub sign-in). To run your own, deploy the Worker in
[`services/faucet`](https://github.com/mericcintosun/AvaKit/tree/main/services/faucet) and set
`NEXT_PUBLIC_AVAKIT_FAUCET_URL` to its `/fund` URL in `.env.local`; set it to `off` and the app
asks no faucet at all.

## How the gate works

The gated section renders only when the visitor's `balanceOf` on the pass contract is above zero:

```ts
// In the component body:
const { address } = useAvaAccount(); // the visitor
const { read } = useContract({ address: passAddress, abi }); // the access-pass contract

// In an effect or handler:
const balance = (await read("balanceOf", [address])) as bigint;
const hasAccess = balance > 0n;
```

While that read is pending, or if it fails, the demo shows a "checking" or "could not check" state
instead of the locked view — an unknown balance is not the same as holding no pass — and it asks
again whenever the connected account changes.

- `contracts/src/AvaKitNFT.sol` — the access-pass ERC-721 (self-contained).
- `lib/nft-artifact.ts` — compiled ABI + bytecode, bundled for browser deploy.

> **Security:** client-side gating is illustrative. For real protected content, verify ownership server-side (e.g. Sign-In with Ethereum + an API check).

## Stack

Next.js 16 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry

## AI-native

Ships with `CLAUDE.md`, `llms.txt`, and `.cursor/rules` so Claude Code / Cursor understand the gate pattern and project conventions.
