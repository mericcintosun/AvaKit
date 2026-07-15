---
"create-avalanche-app": minor
---

Count scaffolds anonymously, so the project can show it gets used.

The CLI now reports which template/wallet/chain/package-manager was picked and whether the scaffold worked, plus a random per-machine id. It never sends project names, paths, code, env vars, or error text, and no IP is stored. It announces itself on the first run and is off via `--no-telemetry`, `AVAKIT_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, or automatically in CI. It cannot fail or slow down a scaffold — worst case it gives up after 1.5 seconds.
