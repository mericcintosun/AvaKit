# hello-avax — AvaKit M1 demo

Connect a wallet, read your balance, and send a first transaction on Avalanche **Fuji** — using `@avakit/react` + `@avakit/core`.

```bash
pnpm install
pnpm --filter @avakit/example-hello-avax dev
# http://localhost:3000
```

## What it shows

- `<AvaKitProvider>` with the Fuji chain and the **injected** adapter (Core / MetaMask) — no API keys needed.
- `<ConnectAvalanche>` drop-in wallet button, rendered straight from a Server Component (`app/page.tsx`): `@avakit/react` ships as a client module.
- `cn` from the server-safe `@avakit/react/utils` entry, used in the server layout.
- `useBalance()` for the native AVAX balance.
- A 0-AVAX self-transaction via `@avakit/core`'s viem wallet client.

## Adding social login (Web3Auth)

The injected path above is the verified M1 demo. To enable social login:

```bash
pnpm add @web3auth/modal
```

```ts
import { web3authAdapter } from "@avakit/core/web3auth";
import { injectedAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";

const adapters = [
  // `chains` makes the embedded wallet land on Fuji instead of Web3Auth's default network.
  web3authAdapter({ clientId: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID!, chains: [fuji] }),
  injectedAdapter(),
];
```

> The Web3Auth adapter is shipped and typed but its live flow needs a (free)
> client ID and a browser to validate — see `docs/04-adr.md` (ADR-011).
