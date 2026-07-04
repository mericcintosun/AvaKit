---
"@avakit/core": patch
"@avakit/react": patch
"create-avalanche-app": patch
---

Enforce the testnet-first deploy guard and make social login discoverable.

- `@avakit/core`: `deployContract` now refuses a non-testnet (mainnet) chain
  unless you pass `confirmMainnet: true`, throwing the new
  `MainnetConfirmationError`. Fuji and other testnets are unaffected. `WalletAdapter`
  gains an optional `unavailableReason`, and `web3authAdapter` sets it when no
  client ID is configured.
- `@avakit/react`: `useAvaDeploy().deploy(artifact, args, { confirmMainnet })`
  threads the flag through. `ConnectAvalanche` now shows an unavailable adapter
  as a disabled button with its `unavailableReason` hint instead of hiding it.
- `create-avalanche-app`: the social-login templates always register the Web3Auth
  adapter, so "social login" is visible (disabled, with a hint to set
  `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID`) instead of silently missing before a client ID
  is configured.
