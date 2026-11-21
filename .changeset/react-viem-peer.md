---
"@avakit/react": patch
---

`viem` (2.58.0 or a later 2.x) is now a peer dependency of `@avakit/react`, because the types of its hooks and components use viem's `Address`, `Hex`, `Abi` and `EIP1193Provider`, which an app with a strict package layout could not resolve, so they silently became `any`.
