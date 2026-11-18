---
"@avakit/studio": patch
---

Studio's Interchain view now works with any number of local L1s: it lists only the running, ICM-ready ones, lets you pick source and destination, links messengers that share an address, and redeploys them after a devnet reset. avalanche-cli actions now belong to the Studio server (one at a time, with a Cancel button), so a run and its log survive switching views, reloading or closing the tab; a malformed request can no longer crash Studio, a failed step is no longer reported as success, and a Data lookup shows an API failure as a failure instead of an empty wallet.
