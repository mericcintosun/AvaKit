# @avakit/core

Framework-agnostic kernel for [AvaKit](https://github.com/mericcintosun/AvaKit) — EVM clients, wallet adapters, deploy helpers, and chain data for Avalanche. Depends only on [viem](https://viem.sh).

With a real wallet (Core / MetaMask, social login, a passkey wallet) the user's private keys stay with the wallet provider: AvaKit only ever uses a signing interface. The one deliberate exception is the testnet-only burner wallet, which holds a throwaway key in the browser — see [the warning below](#the-burner-wallet-holds-a-key-in-the-browser).

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

Chains live at `@avakit/core/chains`. The two adapters that need an extra SDK sit behind their own subpaths, so the main entry never pulls those SDKs in; install the SDK only if you use the adapter:

| Adapter | Import from | Also install |
| --- | --- | --- |
| `web3authAdapter({ clientId })` — social login | `@avakit/core/web3auth` | `@web3auth/modal` |
| `coinbaseAdapter()` — passkey smart wallet | `@avakit/core/coinbase` | `@coinbase/wallet-sdk` |

## What's inside

- **Chains** — `fuji`, `cChain`, `defineChain` for custom L1s, `isMainnet`; each chain carries its `explorerUrl` and, on a testnet, a `faucetUrl` (see [Explorer and faucet links](#explorer-and-faucet-links))
- **Clients** — `getPublicClient`, `getWalletClient`, `toViemChain`
- **Adapters** — `burnerAdapter({ chain })` (a throwaway in-browser wallet, zero setup — see the warning below) + `clearBurner()`; `injectedAdapter()` (Core / MetaMask); `web3authAdapter({ clientId })` (social login, from `@avakit/core/web3auth`); `coinbaseAdapter()` (passkey smart wallet, from `@avakit/core/coinbase`)
- **Network** — `ensureChain(provider, chain)` (add + switch; once it resolves the wallet is on the chain, burner wallet included)
- **Deploy** — `deployContract`, `waitForDeployment`, `getBytecode`
- **Faucet** — `requestFaucet({ url, address, chainId })` asks a faucet API for testnet AVAX, retries a failure that may be temporary and rejects with a typed `FaucetError` (see [Faucet requests](#faucet-requests)); `AVAKIT_FAUCET_URL` is the endpoint of AvaKit's shared Fuji faucet (see [The hosted faucet](#the-hosted-faucet))
- **RPC data** — `getBalance`, `getTransactionReceipt`, `readContract` (take an `AvaChain`)
- **Indexed data (AvaCloud)** — `getNativeBalance`, `listErc20Balances`, `listNfts`, `listTransactions` (take an address + a chain, either an `AvaChain` like `fuji` or a raw chain id like `43113`)

## The burner wallet holds a key in the browser

`burnerAdapter()` is the zero-setup path: it lets someone try a real Fuji transaction without installing a wallet. It is the one place AvaKit itself handles a key, so be precise about what it does:

- It calls viem's `generatePrivateKey()` **in the browser** and, by default, stores that key in **`localStorage` in the clear** (`avakit.burner.pk`). Any script running on the page can read it. There is no HSM and no enclave.
- It is **testnet-only, enforced in code**: it refuses to connect on, or switch to, a mainnet chain, and `<AvaKitProvider>` (`@avakit/react`) disconnects it if the app moves to one. It does not take a chain definition's word for it either: before the first transaction on a chain it asks the node behind `rpcUrl` for its chain id and refuses on a mismatch, and it signs transactions only for the definition's chain id, so a testnet label on a mainnet RPC is refused with nothing signed or sent.
- Treat it as a throwaway session holding a faucet drip, not as a wallet. Never send real funds to a burner address. `clearBurner()` deletes the stored key; `persist: false` keeps the key out of `localStorage` and in memory only, so the adapter keeps its wallet across reconnects and a reload starts a fresh one.
- `injectedAdapter()`, `web3authAdapter()` and `coinbaseAdapter()` are the upgrade path. With those, keys stay with the wallet provider.

## Mainnet is opt-in

Everything defaults to the Fuji testnet. `deployContract` refuses a mainnet chain unless you pass `confirmMainnet: true`, and even then it first checks that the account can pay the estimated cost — a deployment it cannot afford is refused with `InsufficientFundsError` before the wallet is asked to sign.

A chain counts as mainnet unless its definition says `testnet: true`, and always when its id is a known mainnet (`43114`). A definition that leaves the flag out is therefore treated as a mainnet, not as a testnet.

`deployContract` resolves only for a contract that really exists. A deployment transaction that reverted is rejected with `DeployFailedError`, and so is one that succeeded but left no code at the new address: after a successful receipt the code is read back with `eth_getCode`, and because a node can serve a receipt slightly before the state behind it, an empty read is repeated for up to two seconds before the deployment is given up on. `waitForDeployment(txHash, chain)` applies the same checks to a creation transaction you sent yourself (from a script or a server with its own key) and resolves with the same `{ address, txHash, explorerUrl }`.

## Explorer and faucet links

`explorerUrl` is a base, and links are built as `${explorerUrl}/tx/<hash>` and `${explorerUrl}/address/<address>` (that is what `deployContract` returns as `explorerUrl`). The built-in chains point straight at the Avalanche explorer on Builder Hub, so a link ends on the page it names instead of being redirected there:

| Chain | `explorerUrl` |
| --- | --- |
| `fuji` | `https://build.avax.network/explorer/fuji/c-chain` |
| `cChain` | `https://build.avax.network/explorer/mainnet/c-chain` |

`fuji.faucetUrl` is `https://build.avax.network/console/primary-network/faucet`, the Builder Hub faucet. It is a page for people, not an API, and it asks for a free Builder Hub sign-in (the coupon code and mainnet-balance requirements of the earlier faucet are gone). A chain with no explorer or faucet, such as a fresh L1, leaves the field empty.

## Faucet requests

`requestFaucet({ url, address, chainId })` posts to a faucet API (the AvaKit faucet Worker, or anything that speaks the same `POST { address, chainId }` protocol) and resolves with what it reports: `{ txHash, amount, chainId }`.

When the faucet refuses or cannot be reached, it rejects with a `FaucetError`. The message is the faucet's own where it sent one; `code` is for code to branch on:

| `code` | Meaning | `retryable` |
| --- | --- | --- |
| `"rate_limited"` | This address, or this network, was funded recently (HTTP 429) | no |
| `"empty"` | The faucet has run out of funds (a 503 that carries the faucet's own answer) | no |
| `"invalid"` | The request itself was refused: a bad address, a chain the faucet does not serve, a missing or rejected captcha token (400 and every other 4xx) | no |
| `"unavailable"` | The faucet failed on its side: it could not send the drip, is busy or is down (500, 502 and every other 5xx, including a 503 that is a platform or proxy error page rather than the faucet's answer) | yes |
| `"network"` | No answer arrived: the request could not be sent, timed out or was aborted | yes |

The error also carries `status` (the HTTP status, undefined when no answer arrived), `retryAfterMs` (the faucet's `Retry-After`, when it sent one) and `faucetCode` (the faucet's own, more specific refusal code, such as `"address_limited"` or `"faucet_busy"`, when its answer had one). Where the faucet's own code is known it decides `code` ahead of the status, which is how a busy faucet (retryable) is told from an empty one although both answer 503; a 4xx is never treated as retryable, whatever it carries. An answer that is a web page rather than JSON is rejected as `"invalid"` even with a 200: that is what a wrong URL gets from a site that serves its app for every path, and it is not a drip.

```ts
import { FaucetError, requestFaucet } from "@avakit/core";

try {
  await requestFaucet({ url, address, chainId: 43113 });
} catch (e) {
  if (e instanceof FaucetError && e.code === "rate_limited") {
    // funded recently; e.retryAfterMs says how long until the faucet will drip again
  }
}
```

A `retryable` failure is retried before `requestFaucet` gives up; a refusal never is. The options that control it, all optional:

| Option | Default | What it does |
| --- | --- | --- |
| `retries` | `2` | Extra attempts after a retryable failure, so at most three attempts. `0` turns retries off |
| `retryDelayMs` | `800` | Base of the wait between attempts: random between zero and a window that starts here and doubles after every failure (exponential backoff with full jitter). A `Retry-After` of up to five seconds is waited out first; a longer one ends the retries at once |
| `timeoutMs` | `10000` | Limit for one attempt, so a faucet that hangs cannot hang the caller. `0` turns it off |
| `signal` | — | An `AbortSignal`: aborting stops the request and any retry still to come |
| `turnstileToken` | — | A Cloudflare Turnstile token for a faucet that asks for one, sent in the request body. Pass a function to have a fresh token fetched before every attempt (a token is single-use); a plain string is sent once and the request is then not retried |

## The hosted faucet

`AVAKIT_FAUCET_URL` (`https://avakit-faucet.avakit.workers.dev/fund`) is AvaKit's shared, rate-limited Fuji faucet: one small drip per address per day, there so that a first run works without a faucet of your own.

```ts
import { AVAKIT_FAUCET_URL, requestFaucet } from "@avakit/core";

const { txHash } = await requestFaucet({ url: AVAKIT_FAUCET_URL, address: "0x…", chainId: 43113 });
```

It is a shared courtesy, not infrastructure: it can be empty or busy. For anything serious, deploy your own from [`services/faucet`](https://github.com/mericcintosun/AvaKit/tree/main/services/faucet) and pass that URL instead. Nothing in AvaKit falls back to the hosted faucet — it is used only where you pass it.

For React components and hooks, see [`@avakit/react`](https://www.npmjs.com/package/@avakit/react). To scaffold a full app, use [`create-avalanche-app`](https://www.npmjs.com/package/create-avalanche-app).

MIT © AvaKit contributors
