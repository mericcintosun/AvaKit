# @avakit/core

Framework-agnostic kernel for [AvaKit](https://github.com/mericcintosun/AvaKit) — EVM clients, wallet adapters, deploy helpers, and chain data for Avalanche. Depends only on [viem](https://viem.sh). AvaKit never touches private keys.

## Install

```bash
npm install @avakit/core viem
```

> **ESM-only.** `@avakit/core` ships ES modules (no CommonJS build) — use `import`, not `require`. In a CommonJS file, load it with a dynamic `await import("@avakit/core")`. Requires Node `>= 20.11`.

## Usage

```ts
import { fuji, getPublicClient, getBalance, injectedAdapter } from "@avakit/core";

// Read chain data
const balance = await getBalance("0x…", fuji);

// Connect a wallet (browser)
const adapter = injectedAdapter();
const { address, provider } = await adapter.connect();
```

Chains live at `@avakit/core/chains`; the optional Web3Auth social-login adapter at `@avakit/core/web3auth`.

## What's inside

- **Chains** — `fuji`, `cChain`, `defineChain` for custom L1s
- **Clients** — `getPublicClient`, `getWalletClient`, `toViemChain`
- **Adapters** — `burnerAdapter({ chain })` (a throwaway in-browser wallet, zero setup — see the warning below) + `clearBurner()`; `injectedAdapter()` (Core / MetaMask); `web3authAdapter({ clientId })` (social login, from `@avakit/core/web3auth`); `coinbaseAdapter()` (passkey smart wallet, from `@avakit/core/coinbase`)
- **Network** — `ensureChain(provider, chain)` (add + switch)
- **Deploy** — `deployContract`, `getBytecode`
- **RPC data** — `getBalance`, `getTransactionReceipt`, `readContract` (take an `AvaChain`)
- **Indexed data (AvaCloud)** — `getNativeBalance`, `listErc20Balances`, `listNfts`, `listTransactions` (take an address + a chain, either an `AvaChain` like `fuji` or a raw chain id like `43113`)

For React components and hooks, see [`@avakit/react`](https://www.npmjs.com/package/@avakit/react). To scaffold a full app, use [`create-avalanche-app`](https://www.npmjs.com/package/create-avalanche-app).

MIT © AvaKit contributors
