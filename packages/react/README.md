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

export function Providers({ children }) {
  return (
    <AvaKitProvider chains={[fuji]} adapters={[injectedAdapter()]}>
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

- Components: `<AvaKitProvider chains adapters dataApiKey?>` · `<ConnectAvalanche />` · `<TransactionButton to value>`
- Wallet/tx hooks: `useAvaAccount`, `useAvaChain`, `useBalance`, `useContract`, `useAvaDeploy`, `useSendTransaction`, `useAvaKit`
- Data hooks (AvaCloud Data API, no indexer): `useTokenBalances`, `useNfts`, `useTxHistory`

The data hooks load one page at a time. Pass `{ pageSize }` as the second argument, check `hasMore`, and call `fetchMore()` to append the next page:

```tsx
const { tokens, hasMore, fetchMore, isFetchingMore } = useTokenBalances(undefined, { pageSize: 50 });
```

## Server Components

`@avakit/react` is a client module: its bundle starts with `"use client"`. In a Next.js App Router app you can therefore render `<AvaKitProvider>`, `<ConnectAvalanche />` or `<TransactionButton />` straight from a Server Component. The hooks still have to be called from a Client Component.

Functions exported by a client module cannot be called on the server, so the pure helpers also ship in a server-safe entry:

```tsx
// app/page.tsx — a Server Component
import { ConnectAvalanche } from "@avakit/react";
import { cn, humanizeError, shortenAddress } from "@avakit/react/utils";
```

## Styling

Components are shadcn-styled (Radix + Tailwind tokens). Your app needs Tailwind configured with shadcn tokens. The fastest way to get a fully-wired app is [`create-avalanche-app`](https://www.npmjs.com/package/create-avalanche-app).

MIT © AvaKit contributors
