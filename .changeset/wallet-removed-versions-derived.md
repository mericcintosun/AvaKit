---
"create-avalanche-app": minor
"@avakit/mcp": patch
---

Remove the `--wallet` flag, and derive the scaffolded `@avakit/*` version pins per package.

Every scaffold already ships all three wallets (a zero-setup burner, social login, and Core/MetaMask), so `--wallet` chose nothing — it's gone from the CLI, the wizard, the `scaffoldApp` API, the MCP `scaffold_app` tool, and telemetry. An old `-w <value>` invocation is consumed and ignored so it can't be mistaken for the project name.

The `@avakit/core` and `@avakit/react` versions stamped into a scaffolded app are now derived per package at build time, instead of a single hand-maintained constant. The two packages version independently, and a single shared number could pin `@avakit/react@^0.3.0` while react was still 0.2.0 — breaking every `pnpm install`. Each app now pins exactly what shipped, even when the versions diverge.
