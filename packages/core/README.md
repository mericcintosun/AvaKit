# @avakit/core

Framework-agnostic kernel for [AvaKit](https://github.com/mericcintosun/AvaKit) — EVM clients, wallet adapters, deploy helpers, and chain data for Avalanche. Depends only on [viem](https://viem.sh).

With a real wallet (Core / MetaMask, social login, a passkey wallet) the user's private keys stay with the wallet provider: AvaKit only ever uses a signing interface. The one deliberate exception is the testnet-only burner wallet, which holds a throwaway key in the browser — see [the warning below](#the-burner-wallet-holds-a-key-in-the-browser).

## Install

```bash
npm install @avakit/core viem
```

> **ESM-only.** `@avakit/core` ships ES modules (no CommonJS build) — use `import`, not `require`. In a CommonJS file, load it with a dynamic `await import("@avakit/core")`. Requires Node.js `>= 22`, the oldest line AvaKit is tested on.

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

- **Chains** — `fuji`, `cChain`, `defineChain` for custom L1s, `isMainnet`; each chain carries its `explorerUrl` and, on a testnet, a `faucetUrl` (see [Explorer and faucet links](#explorer-and-faucet-links)), and can list several RPC endpoints in `rpcUrls`, read in order with `rpcEndpoints` (see [RPC endpoints and fallback](#rpc-endpoints-and-fallback))
- **Clients** — `getPublicClient`, `getWalletClient`, `getRpcTransport`, `toViemChain`
- **Adapters** — `burnerAdapter({ chain })` (a throwaway in-browser wallet, zero setup — see the warning below) + `clearBurner()`; `injectedAdapter()` (Core / MetaMask); `web3authAdapter({ clientId })` (social login, from `@avakit/core/web3auth`); `coinbaseAdapter()` (passkey smart wallet, from `@avakit/core/coinbase`)
- **Network** — `ensureChain(provider, chain)` (add + switch; once it resolves the wallet is on the chain, burner wallet included)
- **Deploy** — `deployContract`, `waitForDeployment`, `getBytecode`
- **Faucet** — `requestFaucet({ url, address, chainId })` asks a faucet API for testnet AVAX, retries a failure that may be temporary and rejects with a typed `FaucetError` (see [Faucet requests](#faucet-requests)); `AVAKIT_FAUCET_URL` is the endpoint of AvaKit's shared Fuji faucet (see [The hosted faucet](#the-hosted-faucet))
- **RPC data** — `getBalance`, `getTransactionReceipt`, `readContract` (take an `AvaChain`)
- **Indexed data (AvaCloud)** — `getNativeBalance`, `listErc20Balances`, `listNfts`, `listTransactions` (take an address + a chain, either an `AvaChain` like `fuji` or a raw chain id like `43113`)

## The burner wallet holds a key in the browser

`burnerAdapter()` is the zero-setup path: it lets someone try a real Fuji transaction without installing a wallet. It is the one place AvaKit itself handles a key, so be precise about what it does:

- It calls viem's `generatePrivateKey()` **in the browser** and, by default, stores that key in **`localStorage` in the clear** (`avakit.burner.pk`). Any script running on the page can read it. There is no HSM and no enclave.
- It is **testnet-only, enforced in code**: it refuses to connect on, or switch to, a mainnet chain, and `<AvaKitProvider>` (`@avakit/react`) disconnects it if the app moves to one. It does not take a chain definition's word for it either: before it first sends through one of the chain's RPC endpoints it asks that endpoint's node for its chain id and refuses on a mismatch, and it signs transactions only for the definition's chain id, so a testnet label on a mainnet RPC is refused with nothing signed or sent.
- On a chain with several RPC endpoints, it sends each transaction through one of them: the first, in the chain's order, whose node has confirmed the chain. Every request of that send goes there, so a send never moves to another node halfway, and the burner never sends a transaction twice. An endpoint that stops answering is asked again on the next send, which moves on to the next endpoint if it is still gone. Reads it forwards for the app go over the endpoints like `getPublicClient`'s, once each, and the app's own client retries them.
- Treat it as a throwaway session holding a faucet drip, not as a wallet. Never send real funds to a burner address. `clearBurner()` deletes the stored key; `persist: false` keeps the key out of `localStorage` and in memory only, so the adapter keeps its wallet across reconnects and a reload starts a fresh one.
- `injectedAdapter()`, `web3authAdapter()` and `coinbaseAdapter()` are the upgrade path. With those, keys stay with the wallet provider.

## Mainnet is opt-in

Everything defaults to the Fuji testnet. `deployContract` refuses a mainnet chain unless you pass `confirmMainnet: true`, and even then it first checks that the account can pay the estimated cost — a deployment it cannot afford is refused with `InsufficientFundsError` before the wallet is asked to sign.

A chain counts as mainnet unless its definition says `testnet: true`, and always when its id is a known mainnet (`43114`). A definition that leaves the flag out is therefore treated as a mainnet, not as a testnet.

`deployContract` resolves only for a contract that really exists. A deployment transaction that reverted is rejected with `DeployFailedError`, and so is one that succeeded but left no code at the new address: after a successful receipt the code is read back with `eth_getCode`, and because a node can serve a receipt slightly before the state behind it, an empty read is repeated for up to two seconds before the deployment is given up on. `waitForDeployment(txHash, chain)` applies the same checks to a creation transaction you sent yourself (from a script or a server with its own key) and resolves with the same `{ address, txHash, explorerUrl }`.

## RPC endpoints and fallback

Added after 0.2.2. Up to 0.2.2, every chain has its `rpcUrl` alone.

A chain can list more than one JSON-RPC endpoint. `rpcUrl` is the one AvaKit tries first, and the optional `rpcUrls` lists every endpoint in the order they are tried, `rpcUrl` first. `fuji` and `cChain` try Ava Labs' public API first and Allnodes' PublicNode second (`https://avalanche-fuji-c-chain-rpc.publicnode.com`, `https://avalanche-c-chain-rpc.publicnode.com`).

```ts
import { defineChain, getRpcTransport, rpcEndpoints, toViemChain } from "@avakit/core";
import { createPublicClient } from "viem";

const myL1 = defineChain({
  id: 99999,
  name: "My L1",
  rpcUrl: "https://rpc-a.my-l1.example",
  rpcUrls: ["https://rpc-a.my-l1.example", "https://rpc-b.my-l1.example"],
  explorerUrl: "",
  nativeCurrency: { name: "Token", symbol: "TKN", decimals: 18 },
  testnet: true,
});

rpcEndpoints(myL1); // ["https://rpc-a.my-l1.example", "https://rpc-b.my-l1.example"]

// A viem client of your own that talks to the chain the way getPublicClient does.
const client = createPublicClient({ chain: toViemChain(myL1), transport: getRpcTransport(myL1) });
```

- **The order.** `rpcEndpoints(chain)` returns the endpoints in the order they are tried, without repeats. `rpcUrls` counts only when its first entry is `rpcUrl`, so a definition that spreads a built-in chain and replaces its `rpcUrl` (`{ ...fuji, rpcUrl: myNode }`) talks to `myNode` alone, never to the endpoints it replaced. `defineChain` refuses an entry that is not an http(s) URL.
- **Reads.** `getPublicClient(chain)` reads through `getRpcTransport(chain)`, and you can pass that transport to your own viem (or wagmi) client. Every request gives up after 10 seconds. A request that fails on one endpoint (no answer, a timeout, an HTTP error) goes to the next one at once. When the last one fails too, the whole list is tried again, up to three more times, after 150, 300 and 600 ms (or what the endpoint's `Retry-After` says), as long as the failure can pass: a timeout, a network error, HTTP 403, 408, 413, 429, 500, 502, 503 or 504, or a JSON-RPC rate limit or internal error. A revert or a rejected request is the chain's answer, and is neither retried nor sent elsewhere. A call to a chain with N endpoints therefore makes at most 4 × N requests. A chain with one endpoint gets viem's single-endpoint behaviour: up to four attempts there. Nothing pings the endpoints in the background.
- **Wallets.** `toViemChain(chain)` lists every endpoint, and `ensureChain` passes them all, primary first, to a wallet that has to add the chain. `getWalletClient(chain, provider)` sends through the wallet's own provider, so Core, MetaMask and social login use their own RPC, not this list. The burner wallet sends each transaction through one endpoint (see [above](#the-burner-wallet-holds-a-key-in-the-browser)).

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
| `"rate_limited"` | A limit says no for now (HTTP 429): this address, or this network, was funded recently, or the faucet has given out every drip its daily limit allows (`faucetCode` `"daily_limited"`, with `Retry-After` until 00:00 UTC) | no |
| `"empty"` | The faucet has run out of funds (a 503 that carries the faucet's own answer) | no |
| `"paused"` | Whoever runs the faucet has switched it off, for as long as they choose (the faucet's own `faucet_paused`, a 503). Added after 0.2.2, which reads a pause as `"empty"` | no |
| `"invalid"` | The request itself was refused: a bad address, a chain the faucet does not serve, a missing or rejected captcha token (400 and every other 4xx) | no |
| `"unavailable"` | The faucet failed on its side: it could not send the drip, is busy or is down (500, 502 and every other 5xx, including a 503 that is a platform or proxy error page rather than the faucet's answer) | yes |
| `"network"` | No answer arrived: the request could not be sent, timed out or was aborted | yes |

The error also carries `status` (the HTTP status, undefined when no answer arrived), `retryAfterMs` (the faucet's `Retry-After`, when it sent one) and `faucetCode` (the faucet's own, more specific refusal code, such as `"address_limited"`, `"daily_limited"` or `"faucet_busy"`, when its answer had one). Where the faucet's own code is known it decides `code` ahead of the status, which is how a busy faucet (retryable) is told from an empty or a paused one although all three answer 503; a 4xx is never treated as retryable, whatever it carries. An answer that is a web page rather than JSON is rejected as `"invalid"` even with a 200: that is what a wrong URL gets from a site that serves its app for every path, and it is not a drip.

```ts
import { FaucetError, requestFaucet } from "@avakit/core";

try {
  await requestFaucet({ url, address, chainId: 43113 });
} catch (e) {
  if (e instanceof FaucetError && e.code === "rate_limited") {
    // over a limit (funded recently, or the daily limit is spent);
    // e.retryAfterMs says how long until the faucet will drip again
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
