---
"@avakit/studio": patch
---

Studio's Interchain view now works with any number of local L1s: it lists only the running, ICM-ready ones, lets you pick source and destination, links messengers that share an address, replaces a messenger that went with a devnet reset or predates the 256-byte message limit, and delivers a message exactly as typed (checked against that limit before it is sent). avalanche-cli actions now belong to the Studio server (one at a time, with a Cancel button), so a run and its log survive switching views, reloading or closing the tab; a malformed request can no longer crash Studio, a failed step is no longer reported as success, and a Data lookup shows an API failure as a failure instead of an empty wallet.
