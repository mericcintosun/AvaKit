# Evidence: run it yourself, without the maintainer's machine

Everything here can be checked without trusting me. Last updated 2026-11-19.

## Three ways in

| Path | Run | Needs |
|---|---|---|
| Nothing installed | https://avakit.dev/new | A browser. A temporary wallet is created and funded with test AVAX, then deploys an ERC-721 and mints, in about a minute. |
| One command | `npm create avalanche-app@latest my-app -- --template nft-mint`, then `cd my-app && npm run dev` | Node.js 22 or newer and npm. No pnpm, no Foundry, no wallet extension, no account. |
| One prompt | `claude mcp add avakit -- npx -y @avakit/mcp`, then: *"Create an NFT app called my-first-dapp with AvaKit, deploy its contract to Fuji and mint the first NFT. Give me the explorer links."* | Any coding agent with MCP. No key: on Fuji the server signs with a test wallet held only in its memory, funded from AvaKit's faucet. |

## Proof

- **Fresh machines, every day.** [`e2e-fuji.yml`](../../.github/workflows/e2e-fuji.yml) installs the published packages on GitHub-hosted runners: Ubuntu with Node.js 22, 24 and 26, macOS, and Windows, using only Node.js and npm. On each runner it scaffolds through the MCP server and builds the app. On one runner it also deploys and mints on Fuji. The schedule runs daily from 20 November 2026.
  - Latest run, all green: https://github.com/mericcintosun/AvaKit/actions/runs/44567467935
  - Its contract: https://build.avax.network/explorer/fuji/c-chain/address/0x3bEf9325F70d075343FE1f3590E73120337250a2
  - Its mint: https://build.avax.network/explorer/fuji/c-chain/tx/0xd2f54127ef7561dbf5052aee21a7e305eecbb3a6e9bf3a0521bd199b51d32088
  - The same check on your own machine: `node scripts/e2e-fuji.mjs --source npm`.
- **Video (2:37, silent, captioned):** https://youtu.be/_u1CdTQYq_M. It was recorded on my Mac after I removed every AvaKit package, cache, configuration and scaffolded app; the first seconds show the check. One prompt to Claude Code scaffolds, deploys and mints. Then the same app runs in a fresh browser.
  - Agent mint: https://build.avax.network/explorer/fuji/c-chain/tx/0x3d60f5284c1553568afc7a0ac6f6f29a871fb34b14c67d755669e7565d6a3b49
  - Browser mint: https://build.avax.network/explorer/fuji/c-chain/tx/0xebac7ea44c487ad0a63a52cd03d34590bb441f2445fc884e369eaeb9ea0ab208
- **Packages on npm, with provenance:**
  - create-avalanche-app 0.4.3;
  - @avakit/core 0.2.2 and @avakit/react 0.2.2;
  - @avakit/mcp 0.2.1, listed in the official MCP Registry as `dev.avakit/avalanche`;
  - @avakit/studio 0.1.14.
- **This week's work:** a review of the whole repository in nine areas found 108 issues, and 103 are fixed. The week also added the key-free agent path, the failure handling in [reliability.md](reliability.md), the daily run, and a hardened faucet. All of it is in https://github.com/mericcintosun/AvaKit/pull/26.

## Where it stands, honestly

- **Usage is small.** The [public counter](https://avakit.dev/stats) shows 10 anonymous scaffolds between 15 July and 17 November 2026. On 18 November test runs added 52 by mistake; that day was removed on 19 November. None of these counts as a validated user.
- **Gaps:**
  - Three of the eight templates (L1 launch, ICM messenger, token bridge) depend on Avalanche CLI, which is in maintenance mode. They were last proven end to end in July.
  - No test drives a browser.
  - The full list is in [KNOWN-GAPS.md](../KNOWN-GAPS.md).
