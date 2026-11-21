---
"@avakit/mcp": patch
---

When the AvaKit faucet does not fund the session test wallet, the server now gives a reason of its own for every code the faucet can answer with: a paused faucet is reported as paused until further notice rather than "out of test AVAX", a spent daily limit as the daily limit for all callers being reached, with the time until it resets, and the limit for your network no longer calls itself hourly, because the faucet gives the same answer after ten failed attempts in five minutes; a rejected address, a chain the faucet does not serve, a contract recipient and a URL that is not the faucet's `/fund` endpoint each get their own reason, and a failure on the faucet's side names what it reported. Neither new refusal is asked again. `@avakit/mcp` is also released for the `@avakit/core` it bundles, which now reads a pause as `"paused"`.
