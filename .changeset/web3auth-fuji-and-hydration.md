---
"@avakit/core": patch
"create-avalanche-app": patch
---

Fix social login landing on the wrong network, and silence a harmless hydration warning.

- `@avakit/core`: `web3authAdapter` now accepts a `chains` option and configures
  Web3Auth with those chains at init (the first is the default the embedded wallet
  connects on). This makes a Google/social sign-in land directly on the app's
  chain (e.g. Fuji) instead of Web3Auth's default network, fixing the "wrong
  network — switch to this app's chain" error after signing in.
- `create-avalanche-app`: the social-login templates pass their target chain to
  `web3authAdapter`, and every template adds `suppressHydrationWarning` to
  `<body>` to silence the hydration warning that browser wallet extensions cause
  by injecting attributes into the DOM.
