# @avakit/react

React layer for [AvaKit](https://github.com/mericcintosun/AvaKit) — a drop-in `<ConnectAvalanche>` social-login wallet button and hooks, built on shadcn/ui.

## Install

```bash
npm install @avakit/react @avakit/core viem react react-dom
```

## Usage

```tsx
// providers.tsx
"use client";
import { injectedAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { AvaKitProvider } from "@avakit/react";
import { useMemo } from "react";

export function Providers({ children }) {
  // Create the adapters once, not on every render.
  const adapters = useMemo(() => [injectedAdapter()], []);
  return (
    <AvaKitProvider chains={[fuji]} adapters={adapters}>
      {children}
    </AvaKitProvider>
  );
}
```

```tsx
import { ConnectAvalanche, useAvaAccount, useBalance } from "@avakit/react";

export function Header() {
  const { address, isConnected } = useAvaAccount();
  return <ConnectAvalanche />;
}
```

To add social login, install `@web3auth/modal` and pass `web3authAdapter({ clientId })` (from `@avakit/core/web3auth`).

## API

- Components: `<AvaKitProvider chains adapters dataApiKey? faucetUrl? faucetToken? autoConnect?>` · `<ConnectAvalanche />` · `<TransactionButton to value>`
- Wallet/tx hooks: `useAvaKit`, `useAvaAccount`, `useAvaChain`, `useBalance`, `useContract`, `useAvaDeploy`, `useSendTransaction`, `useFaucet`
- Data hooks (AvaCloud Data API, no indexer): `useTokenBalances`, `useNfts`, `useTxHistory`
- Helpers: `humanizeError`, `shortenAddress`, `cn`, `Button`, `buttonVariants`

The data hooks load one page at a time. Pass `{ pageSize }` as the second argument, check `hasMore`, and call `fetchMore()` to append the next page:

```tsx
const { tokens, hasMore, fetchMore, isFetchingMore } = useTokenBalances(undefined, { pageSize: 50 });
```

## Wallet behaviour

- **The provider follows the wallet.** When the user switches account or network in the wallet, locks it, or revokes the site, `<AvaKitProvider>` updates `address` and `chain`, or disconnects. A network that is not in `chains` is not adopted: the app keeps its chain and the next transaction reports the mismatch.
- **The burner wallet is testnet-only.** `burnerAdapter()` keeps a throwaway key in `localStorage` in the clear. While the active chain is a mainnet, `<AvaKitProvider>` refuses to connect it and disconnects an active one, and `<ConnectAvalanche />` does not offer it. See the [`@avakit/core` README](https://www.npmjs.com/package/@avakit/core).
- **Mainnet deploys are opt-in.** `useAvaDeploy().deploy(artifact, args, { confirmMainnet: true })`. The account's balance is checked against the estimated cost before anything is sent.
- **A deploy counts only when the contract exists.** `useAvaDeploy()` reports `success` once the deployment transaction has succeeded and the contract's code has been read back from the chain. A reverted deployment, or one that left no code at the new address, ends in `error` with a `DeployFailedError`.

## Test funds

Give `<AvaKitProvider>` a `faucetUrl` and a burner wallet is funded when it connects, so a first transaction needs no trip to a faucet page:

```tsx
import { AVAKIT_FAUCET_URL, burnerAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";

const adapters = useMemo(() => [burnerAdapter()], []);

<AvaKitProvider chains={[fuji]} adapters={adapters} faucetUrl={AVAKIT_FAUCET_URL}>
  {children}
</AvaKitProvider>
```

`AVAKIT_FAUCET_URL` is AvaKit's shared Fuji faucet (one small drip per address per day): fine for a first run, and something to replace with your own deployment of [`services/faucet`](https://github.com/mericcintosun/AvaKit/tree/main/services/faucet) for anything serious. Without a `faucetUrl` nothing is ever requested.

The automatic drip is for the burner wallet only, on a testnet only, and once per address. The balance is read first and a wallet that already holds funds is left alone, so reloading the page neither spends a drip nor shows a "funded recently" error. (If the balance cannot be read within five seconds, the faucet is asked anyway.)

`useFaucet()` reports what the faucet is doing. Its state lives in the provider, so it shows the automatic drip exactly as it shows a manual `fund()`, in every component that reads it:

```tsx
import { useFaucet } from "@avakit/react";

function TestFunds() {
  const { status, error, fund, enabled } = useFaucet();
  const request = () => void fund().catch(() => {}); // the failure is in `error`

  if (!enabled) return null; // no faucet configured, or the chain is a mainnet
  if (status === "funding") return <p>Funding your wallet…</p>;
  if (status === "success") return <p>Funded.</p>;
  if (status === "error") {
    return (
      <p>
        The faucet refused: {error?.message} <button onClick={request}>Try again</button>
      </p>
    );
  }
  return <button onClick={request}>Get test AVAX</button>;
}
```

- `status` is `"idle"`, `"funding"`, `"success"` or `"error"`; `isFunding`, `result` (the drip's `txHash` and `amount`) and `error` go with it, and `reset()` returns to `"idle"`.
- `"success"` means the faucet sent the drip. The balance follows once that transaction is mined, so refetch it (`useBalance().refetch()`).
- A failure that may be temporary (the faucet is busy, could not send, or did not answer) is retried a bounded number of times before `status` becomes `"error"`; a refusal (rate limit, empty faucet, bad request) is reported at once. Nothing retries forever.
- `error` from the faucet is a `FaucetError` (`@avakit/core`): `code` is `"rate_limited"`, `"empty"`, `"invalid"`, `"unavailable"` or `"network"`, `retryable` says whether trying again may help, and `retryAfterMs` how long the faucet asked to wait, when it said.
- `fund(address?)` asks by hand, for the connected account or another address. Called while a request for the same address is in flight, it joins that request rather than sending a second one.
- The state describes the connected account on the active chain, and reads `"idle"` again when either changes. On a mainnet `enabled` is false and `fund()` refuses without sending anything.

If your faucet asks for a Cloudflare Turnstile token, pass `faucetToken`. It is called before every request, each retry included, because a token can be used only once:

```tsx
<AvaKitProvider faucetUrl={faucetUrl} faucetToken={() => getTurnstileToken()} …>
```

## Server Components

`@avakit/react` is a client module: its bundle starts with `"use client"`. In a Next.js App Router app you can therefore render `<ConnectAvalanche />` or `<TransactionButton />` straight from a Server Component. The hooks still have to be called from a Client Component, and `<AvaKitProvider>` belongs in a small `"use client"` file like the one above, because wallet adapters cannot be passed from the server.

Functions exported by a client module cannot be called on the server, so the pure helpers also ship in a server-safe entry:

```tsx
// app/page.tsx — a Server Component
import { ConnectAvalanche } from "@avakit/react";
import { cn, humanizeError, shortenAddress } from "@avakit/react/utils";
```

## Styling

Components are shadcn-styled (Radix + Tailwind tokens). Your app needs Tailwind configured with shadcn tokens. The fastest way to get a fully-wired app is [`create-avalanche-app`](https://www.npmjs.com/package/create-avalanche-app).

MIT © AvaKit contributors
