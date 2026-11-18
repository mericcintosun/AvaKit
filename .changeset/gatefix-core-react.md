---
"@avakit/core": patch
"@avakit/react": patch
---

The temporary (burner) wallet now asks the chain's RPC which chain it serves before its first transaction on that chain, and signs a transaction only for the chain id its definition names: a chain defined as a testnet whose `rpcUrl` points at a mainnet (or any other chain) is refused with an error that starts "Nothing was signed or sent:", and `humanizeError` shows that message instead of viem's "An unknown RPC error occurred.". In `@avakit/react`, a `fund()` that joins a faucet request already in flight (for example after `reset()`) now reports "funding" and the outcome through `useFaucet()` instead of leaving it at "idle", and calling `fetchMore()` twice from the same render no longer fetches and appends the same page twice.
