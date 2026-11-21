# __PROJECT_NAME__

An Avalanche **cross-chain messaging** dapp scaffolded with [AvaKit](https://github.com/mericcintosun/AvaKit). Send a string from one Avalanche L1 to another using **Interchain Messaging (ICM / Teleporter)** — against a local devnet you bring up with one command.

> **Experimental.** This template depends on Avalanche CLI, which has been in maintenance mode
> since December 2025, and it was last proven end to end in July 2026. `create-avalanche-app`
> labels it experimental and warns when you choose it. See [Tooling status](#tooling-status).

## Getting started

The commands are written for npm; pnpm, yarn and bun work as well.

```bash
# 1. start two local L1s with ICM + a relayer (writes icm.config.json)
npm run devnet

# 2. run the app
npm run dev    # http://localhost:3000 (or the port Next prints)
```

`npm run devnet` needs [avalanche-cli](https://github.com/ava-labs/avalanche-cli) (see [Tooling status](#tooling-status)) and a Unix-like shell (macOS, Linux, or **WSL2** on Windows — the script is bash):

```bash
curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin
```

The two local chains are named `icm1`/`icm2` (EVM chainIds 1001/1002), so this can run alongside the token-bridge devnet without colliding.

Then in your wallet (Core / MetaMask), **import the EWOQ dev key** — avalanche-cli's public local dev key, pre-funded on both local chains. `npm run devnet` prints it when it finishes; it is also on the `ewoq` row of `avalanche blockchain describe icm1`. It is deliberately not written in this repo (secret scanners flag committed keys, even public dev ones). Never use it on a real network.

## Tooling status

`npm run devnet` (`scripts/devnet.sh`) drives **Avalanche CLI** (the `avalanche` command, from
[ava-labs/avalanche-cli](https://github.com/ava-labs/avalanche-cli)). What to know before you rely on it:

- Ava Labs put Avalanche CLI in maintenance mode in December 2025, and on 2026-10-06 removed its
  pages from the Avalanche documentation in favour of Platform CLI.
- This template was last proven end to end in July 2026, with Avalanche CLI 1.9.6 (check yours
  with `avalanche --version`). The script has been changed since then, and the changed version has
  not been through a full run on a live network yet. It reads what `avalanche blockchain describe`
  prints, so another CLI version may need adjustments.
- Moving this template to the supported toolchain is planned work and is not done yet.

## The flow

1. **Deploy the messenger** on both chains — `icm1` and `icm2` (one click each — deploys from your browser).
2. **Link them** — each side registers the other as its **trusted remote** (one click, two transactions, one per chain). Receiving rejects unregistered sources, so this unlocks sending.
3. **Send** a message from one chain to the other (up to 256 bytes — the contract rejects longer ones, and the app tells you before you send).
4. The relayer delivers it; the destination contract checks the source is trusted and stores it. The app polls and shows it **arrive** on the other L1. If it has not arrived after 30 seconds the app says so instead of waiting forever — usually the relayer is not running (`avalanche network status`).

## How it works

- `contracts/src/AvaKitMessenger.sol` — one self-contained contract that both **sends** (`TeleporterMessenger.sendCrossChainMessage`) and **receives** (`ITeleporterReceiver.receiveTeleporterMessage`). Deployed on both chains and linked: each side only accepts messages from its registered **trusted remote** (owner-set), and the Teleporter address is an immutable constructor parameter. Three limits are built in:
  - **Message size:** at most 256 bytes of UTF-8 (`MAX_MESSAGE_LENGTH`). `sendMessage` reverts with `AvaKitMessenger: message too long` above that, and the app counts bytes the same way before it lets you send (most emoji are four bytes, not one).
  - **Delivery gas:** the destination chain runs `receiveTeleporterMessage` with 350,000 gas — enough to store the longest message. That fixed budget is why the size is capped; if you raise one, raise the other.
  - **Trust:** a chain is trusted only while a non-zero remote is registered for it. `setTrustedRemote(blockchainID, address(0))` stops accepting messages from that chain again.
- `scripts/devnet.sh` — creates two subnet-EVM L1s, deploys them locally, and lets avalanche-cli wire the TeleporterMessenger + relayer automatically. It then reads each chain's RPC URL, **hex blockchain ID** and TeleporterMessenger address from `avalanche blockchain describe`, checks that a contract really is deployed at that address on both chains (it stops with an error if not), and writes them into `icm.config.json`.
- `lib/devnet.ts` — turns that config into AvaKit chains and exposes `blockchainIdOf(chain)`.

> **Gotcha:** ICM routes by the **bytes32 blockchain ID** (hex), not the EVM `chainId`. This template handles that for you — see `lib/devnet.ts`.

To change the contract:

```bash
cd contracts && forge build
# copy out/AvaKitMessenger.sol/AvaKitMessenger.json (abi + bytecode.object) into lib/messenger-artifact.ts
```

## Stop trusting a chain

Each messenger only accepts messages from the remote its owner registered. To make one side stop
accepting them, the wallet that deployed that messenger calls
`setTrustedRemote(<the other chain's hex blockchain ID>, address(0))` on it — the same call the
**Link the messengers** button makes, with the zero address instead of the other messenger:

```ts
await ensureChain(provider, chain); // the chain of the messenger that should stop receiving
await getWalletClient(chain, provider).writeContract({
  address: messenger,
  abi,
  functionName: "setTrustedRemote",
  args: [blockchainIdOf(otherChain), zeroAddress],
  account: address, // must be that messenger's owner
} as never);
```

From then on a delivery from that chain is rejected (`AvaKitMessenger: untrusted remote`), the app
shows that side as **not linked** and holds sending back, and **Link the messengers** registers the
remote again.

## Reset the devnet

```bash
avalanche network stop     # pause (keeps state)
avalanche network clean    # wipe (new blockchain IDs — re-run npm run devnet)
CLEAN=1 npm run devnet     # wipe + rebuild in one step (use if a stale network blocks the deploy)
```

A wipe creates brand-new chains (same chainIds, new blockchain IDs), so the messengers you deployed
are gone. The app notices on its own — it only uses a remembered address while the chain still has
code there — and offers **Deploy messenger** again; deploy and link once more.

## Stack

Next.js 16 · React 19 · `@avakit/react` · `@avakit/core` · viem · shadcn/ui · Foundry · avalanche-cli

MIT
