---
"create-avalanche-app": patch
"@avakit/mcp": patch
---

The eerc-token template is pinned to the 2026-08-31 security fixes of `ava-labs/EncryptedERC`, so `npm run deploy:eerc`, which at the old pin stopped at its compile step on a clean machine and would otherwise have deployed verifiers that reject every proof the app makes and accept forged ones, now deploys an instance the app can register, mint, transfer and burn on, and new apps start on a shared Fuji instance deployed the same way (`@avakit/mcp` is released with it because the server pins the scaffolder it ships).
