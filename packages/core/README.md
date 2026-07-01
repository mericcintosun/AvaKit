# @avakit/core

Framework-agnostic kernel for [AvaKit](https://github.com/mericcintosun/AvaKit) — EVM clients, wallet adapters, deploy helpers, and chain data for Avalanche. Depends only on [viem](https://viem.sh). AvaKit never touches private keys.

## Install

```bash
npm install @avakit/core viem
```

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
- **Adapters** — `injectedAdapter()` (Core / MetaMask); `web3authAdapter({ clientId })` (social login, from `@avakit/core/web3auth`)
- **Network** — `ensureChain(provider, chain)` (add + switch)
- **Deploy** — `deployContract`, `getBytecode`
- **Data** — `getBalance`, `getTransactionReceipt`, `readContract`

For React components and hooks, see [`@avakit/react`](https://www.npmjs.com/package/@avakit/react). To scaffold a full app, use [`create-avalanche-app`](https://www.npmjs.com/package/create-avalanche-app).

MIT © AvaKit contributors
