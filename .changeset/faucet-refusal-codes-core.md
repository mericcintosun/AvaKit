---
"@avakit/core": patch
---

A faucet its operator has paused (the AvaKit faucet's `503 faucet_paused`) now makes `requestFaucet` reject with the new `FaucetError` code `"paused"`, no longer with `"empty"`, which is what a 503 reads as by its status alone; it is not retried, and the message is still the faucet's own. The faucet's other new refusal, a spent daily limit (`429 daily_limited`), is now read as `"rate_limited"` by its code, as it already was by its status, with a `retryAfterMs` that counts down to 00:00 UTC.
