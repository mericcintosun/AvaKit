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

- Components: `<AvaKitProvider chains adapters dataApiKey? faucetUrl? autoConnect?>` · `<ConnectAvalanche />` · `<TransactionButton to value>`
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
