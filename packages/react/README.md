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

- Components: `<AvaKitProvider chains adapters>` · `<ConnectAvalanche />` · `<TransactionButton to value>`
- Hooks: `useAvaAccount`, `useAvaChain`, `useBalance`, `useContract`, `useAvaDeploy`, `useSendTransaction`, `useAvaKit`

## Styling

Components are shadcn-styled (Radix + Tailwind tokens). Your app needs Tailwind configured with shadcn tokens. The fastest way to get a fully-wired app is [`create-avalanche-app`](https://www.npmjs.com/package/create-avalanche-app).

MIT © AvaKit contributors
