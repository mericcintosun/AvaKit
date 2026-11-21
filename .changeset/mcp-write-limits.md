---
"@avakit/mcp": minor
---

`write_contract` now calls only the contracts the server deployed in the same session and the ones listed in `AVAKIT_WRITE_ALLOWLIST` (`*` allows any), and one `deploy_contract` or `write_contract` call sends at most `AVAKIT_MAX_VALUE` AVAX (0.1 by default). A refusal names the variable to change and says that nothing was signed or sent. The limits apply to each call: repeated calls are not capped, and a contract the server deployed can pass on the calls and AVAX it receives. If you call a contract deployed outside the current server session, list its address in `AVAKIT_WRITE_ALLOWLIST`.
