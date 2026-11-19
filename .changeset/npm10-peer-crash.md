---
"create-avalanche-app": patch
"@avakit/mcp": patch
---

Scaffolded apps now install with npm 10, the npm that ships with Node.js 22. The social login SDK they all include (`@web3auth/modal`) lists vitest among its runtime dependencies, and the peer dependencies that brings in made npm 10 stop with "Cannot read properties of null (reading 'edgesOut')". Every app now has an `.npmrc` with `legacy-peer-deps=true`; it lists every peer it needs as a dependency of its own, so nothing is lost. `@avakit/mcp` is released with it, because the server pins the scaffolder it ships.
