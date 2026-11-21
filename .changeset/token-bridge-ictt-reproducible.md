---
"create-avalanche-app": patch
"@avakit/mcp": patch
---

The token-bridge template's bridge contracts (`ERC20TokenHome`, `ERC20TokenRemote` and `TeleporterRegistry` in `lib/ictt-artifacts.json`) are now the build of `ava-labs/icm-contracts` v1.0.9 that the AvaKit repository repeats and compares byte for byte on every change, with the same code and ABI as before and only the metadata hash at the end of each bytecode changed; `@avakit/mcp` is released with it because the server pins the scaffolder it ships.
