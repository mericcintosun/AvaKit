---
"@avakit/core": patch
"@avakit/react": patch
---

Faucet requests now fail with a typed `FaucetError` (`code`, `retryable`, `retryAfterMs`), retry a temporary failure a bounded number of times and give up on a faucet that hangs, and `useFaucet()` shows the automatic burner drip as well as a manual `fund()` while leaving a wallet that already holds funds alone. `deployContract` resolves only once the contract's code is on chain, the built-in explorer and faucet links point straight at Builder Hub instead of redirecting there, and the hosted faucet endpoint is exported as `AVAKIT_FAUCET_URL`.
