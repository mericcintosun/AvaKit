---
"@avakit/react": patch
---

`useFaucet().error` now reports a faucet its operator has paused with `code: "paused"` from `@avakit/core`, no longer as `"empty"`; it is not retried, and the message is still the faucet's own, so a notice that shows the message needs no change.
