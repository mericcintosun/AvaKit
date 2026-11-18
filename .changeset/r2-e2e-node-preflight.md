---
"create-avalanche-app": patch
---

The CLI now checks the Node.js version before it does anything else. Below the supported
floor (`>=20.11`) it stops with one line that names the version it found and the one it
needs, instead of failing part-way through with a stack trace; on Node.js 20 or 21 it
still runs, after one warning that Node.js 20 reached end-of-life in April 2026 and that
AvaKit is tested on Node.js 22 and 24.

The published package can no longer carry what tools leave in a template directory: Foundry
build output (`contracts/out`, `cache`, `broadcast`), `node_modules`, `.next`, `.turbo` and
`.env` files are now excluded by `files` itself. Until now only a publish from a clean
checkout was free of them.
