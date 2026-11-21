---
"@avakit/mcp": minor
---

`write_contract` now calls only the contracts the server deployed in the same session and the ones listed in `AVAKIT_WRITE_ALLOWLIST` (`*` allows any), and `deploy_contract` and `write_contract` send at most `AVAKIT_MAX_VALUE` AVAX with one call (0.1 by default), so a prompt-injected agent can no longer call an arbitrary contract or send it your AVAX, and a refusal names the variable to change and says that nothing was signed or sent.
