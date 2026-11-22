# Evidence: run it yourself, without the maintainer's machine

Everything here can be checked without trusting me. Last updated 2026-11-22.

## Three ways in

| Path | Run | Needs |
|---|---|---|
| Nothing installed | https://avakit.dev/new | A browser. A temporary wallet is created and funded with test AVAX, then deploys an ERC-721 and mints, in about a minute. |
| One command | `npm create avalanche-app@latest my-app -- --template nft-mint`, then `cd my-app && npm run dev` | Node.js 22 or newer and npm. No pnpm, no Foundry, no wallet extension, no account. |
| One prompt | `claude mcp add avakit -- npx -y @avakit/mcp`, then: *"Create an NFT app called my-first-dapp with AvaKit, deploy its contract to Fuji and mint the first NFT. Give me the explorer links."* | Any coding agent with MCP. No key: on Fuji the server signs with a test wallet held only in its memory, funded from AvaKit's faucet. |

## Proof

- **Fresh machines, every day.** [`e2e-fuji.yml`](../../.github/workflows/e2e-fuji.yml) installs the published packages on GitHub-hosted runners: Ubuntu with Node.js 22, 24 and 26, macOS, and Windows, using only Node.js and npm. On each runner it scaffolds through the MCP server and builds the app. On one runner it also deploys and mints on Fuji. The schedule runs daily from 20 November 2026; GitHub starts it hours after its 05:23 UTC slot.
  - Run by hand on 19 November, all green: https://github.com/mericcintosun/AvaKit/actions/runs/44567467935 ([contract](https://build.avax.network/explorer/fuji/c-chain/address/0x3bEf9325F70d075343FE1f3590E73120337250a2), [mint](https://build.avax.network/explorer/fuji/c-chain/tx/0xd2f54127ef7561dbf5052aee21a7e305eecbb3a6e9bf3a0521bd199b51d32088))
  - Scheduled runs, all green: 20 November (https://github.com/mericcintosun/AvaKit/actions/runs/44750893968), 21 November (https://github.com/mericcintosun/AvaKit/actions/runs/44909637601) and 22 November (https://github.com/mericcintosun/AvaKit/actions/runs/45027606773), each on the versions then on npm
  - The 21 November contract: https://build.avax.network/explorer/fuji/c-chain/address/0xCf59eE8a38F43302880984ddF1fce0D759620ba6
  - Its mint: https://build.avax.network/explorer/fuji/c-chain/tx/0x87f4ec3e012e9aff4f3735914c480312e97e1451231d467c0ac9816cc44c1a99
  - The same check on your own machine: `node scripts/e2e-fuji.mjs --source npm`.
- **Video (2:37, silent, captioned):** https://youtu.be/_u1CdTQYq_M. It was recorded on my Mac after I removed every AvaKit package, cache, configuration and scaffolded app; the first seconds show the check. One prompt to Claude Code scaffolds, deploys and mints. Then the same app runs in a fresh browser.
  - Agent mint: https://build.avax.network/explorer/fuji/c-chain/tx/0x3d60f5284c1553568afc7a0ac6f6f29a871fb34b14c67d755669e7565d6a3b49
  - Browser mint: https://build.avax.network/explorer/fuji/c-chain/tx/0xebac7ea44c487ad0a63a52cd03d34590bb441f2445fc884e369eaeb9ea0ab208
- **Packages on npm, with provenance,** released on 22 November by the release workflow after my approval (https://github.com/mericcintosun/AvaKit/actions/runs/45056347905):
  - create-avalanche-app 0.5.0;
  - @avakit/core 0.2.3 and @avakit/react 0.2.3;
  - @avakit/mcp 0.3.0, listed in the official MCP Registry as `dev.avakit/avalanche` 0.3.0;
  - @avakit/studio 0.1.15.
- **New in that release:**
  - an RPC fallback in @avakit/core: PublicNode after Ava Labs' API, on Fuji and C-Chain;
  - per-call write limits in the MCP server: only the contracts it deployed or that you list, and at most 0.1 AVAX a call by default;
  - the eERC template on upstream's 2026-08-31 contract fixes;
  - the three Avalanche CLI templates marked experimental;
  - Node.js 22 as the floor of every package.
- **Outside npm:** browser tests on every pull request; CodeQL, gitleaks and OpenSSF Scorecard; a publish job that waits for my approval in the `npm-publish` environment, which each package's Trusted Publisher on npm names, so npm enforces that approval too; a nonce-based Content-Security-Policy for avakit.dev, which uses @avakit/core 0.2.3, so /new falls back to PublicNode when Ava Labs' Fuji RPC fails; and the faucet and telemetry Workers, deployed on 22 November through their own workflow after my approval. The faucet now has a daily budget and a kill switch, and `GET /health` on both Workers reports the deployed commit.
- **The work of 17–19 November:** a review of the whole repository in nine areas found 108 issues, and 103 are fixed. Those days also added the key-free agent path, the failure handling in [reliability.md](reliability.md), the daily run, and a hardened faucet. All of it is in https://github.com/mericcintosun/AvaKit/pull/26.

## Where it stands, honestly

- **Usage is small.** The [public counter](https://avakit.dev/stats) shows 10 anonymous scaffolds between 15 July and 17 November 2026, and none since (checked 21 November). On 18 November test runs added 52 by mistake; that day was removed on 19 November. None of these counts as a validated user.
- **Gaps:**
  - Three of the eight templates (L1 launch, ICM messenger, token bridge) depend on Avalanche CLI, which is in maintenance mode. They were last proven end to end in July, and are now marked experimental.
  - The browser tests drive avakit.dev/new and one scaffolded template (`nft-mint`). No test signs in with Google.
  - The hosted faucet runs without Turnstile, so one script can spend its daily budget for requests without a token.
  - The full list is in [KNOWN-GAPS.md](../KNOWN-GAPS.md).
