# contracts-ci

Repo-only Foundry harness for the Solidity the templates ship. It is not part
of any npm package and nothing here reaches users — templates stay
zero-dependency ("compiles out of the box with `forge build`"); this directory
exists so CI can actually compile and test that Solidity.

## What runs

```bash
cd contracts-ci
node scripts/sync.mjs              # copy template contracts into src/ + consistency checks
forge test                         # compile (pinned compiler) + run the test suite
node scripts/check-artifacts.mjs   # shipped abi + bytecode still match the source
node --test scripts/guards.test.mjs  # the two scripts above still catch what they are for
```

- **`scripts/sync.mjs`** copies each template contract into `src/` and fails if
  templates that ship the same contract have drifted apart (`erc20-token` /
  `l1-launch` share `AvaKitToken.sol`; `nft-mint` / `token-gated-app` share
  `AvaKitNFT.sol`). `src/` is generated — never edit it here; edit the template
  copies (both of them) instead. It also fails if any `foundry.toml` in the
  repo compiles with different settings than this harness (see Toolchain).
  It reads the `[profile.default]` table and nothing else, so it stops on
  everything else forge would apply to the default profile instead of
  skipping it: a sub-table or array table (`[profile.default.optimizer_details]`,
  `[[profile.default.compilation_restrictions]]`), the header in any other
  spelling (quoted keys, extra spaces), the legacy `[default]` table and a key
  above the first table.
- **`test/`** covers mint/transfer/allowance for the token; mint, the ERC-721
  transfer and approval surface and the on-chain `tokenURI` (unchanged by
  transfers, labelled with the chain it is on, described without a URL or a
  claim about what minting cost) for the NFT; and send/receive
  for the ICM messenger: the Teleporter caller check, the trusted-remote
  allowlist, the message length cap and the gas a delivery has to fit in.
- **`test/TestBase.sol`** inlines the few Foundry cheatcodes the tests need
  instead of pulling in forge-std — the same zero-dependency spirit as the
  contracts themselves.
- **`scripts/check-artifacts.mjs`** rebuilds every contract and fails if a
  shipped artifact no longer matches the source it is generated from: each
  template's `lib/*-artifact.ts`, the messenger bytecode Studio deploys
  (`packages/studio/src/messenger-artifact.ts`, where the `*_SIG` constants
  Studio calls the contract with are checked against its ABI too), the
  contract the website's `/new` page deploys (`apps/web/lib/nft-artifact.ts`,
  which has to be the `nft-mint` template's), the example app's
  (`examples/web3auth-demo/lib/nft-artifact.ts`), and all four contracts the
  `token-bridge` template deploys from its `lib/ictt-artifacts.json`: the
  `DemoToken`, which has to be the `erc20-token` template's `AvaKitToken`, and
  the bridge itself (`ERC20TokenHome`, `ERC20TokenRemote`,
  `TeleporterRegistry`), built from `ava-labs/icm-contracts` (see
  [Upstream contracts](#upstream-contracts)). Every byte is compared, the
  metadata hash at the end of the code included; when that hash is all that
  differs, the report says so (`only in its metadata hash`), but it is still
  drift. `--write` rewrites only the artifacts that drifted. It fails on any
  committed `*-artifact.ts` or `*-artifacts.json` that it has not been told
  about, and on any entry of a JSON artifact file without a row of its own, so
  a new artifact cannot land unchecked. It builds into a temporary directory,
  so it leaves no `out/` or `cache/` behind in a template (those folders would
  be copied into every app scaffolded from this checkout).
- **`scripts/upstream.mjs`** fetches the pinned sources of the upstream
  contracts for that check, and re-pins them (below).
- **`scripts/guards.test.mjs`** tests the scripts themselves (Node's
  built-in test runner, no dependencies). Each test copies the files the
  scripts read into a temporary directory, breaks one thing there (a
  `foundry.toml` that changes the compiler outside `[profile.default]`, a
  stale `DemoToken`, one changed byte in the code or the metadata hash of a
  bridge contract, an upstream source that is not the pinned one, a damaged
  cached source, an artifact nobody listed) and expects the script to notice.

`examples/web3auth-demo` ships a different, simpler `AvaKitNFT` on purpose. It
is an example app, not a template, so its contract is not compiled into this
harness or tested here — but its artifact is checked against its own source,
and it compiles with the same pinned settings.

## Editing a contract

1. Edit the template's `contracts/src/*.sol` — both copies when two templates
   share the contract.
2. `node scripts/sync.mjs && forge test`
3. `node scripts/check-artifacts.mjs --write` regenerates the abi + bytecode of
   every artifact built from that contract, in place. Commit them with the
   source change; CI fails on any artifact left behind.

## Upstream contracts

`token-bridge` ships three contracts it did not write: `ERC20TokenHome`,
`ERC20TokenRemote` and `TeleporterRegistry` from
[`ava-labs/icm-contracts`](https://github.com/ava-labs/icm-contracts) `v1.0.9`.
Their source is not vendored here, on purpose: it is under Ava Labs'
Ecosystem License, not MIT. The recipe is, in `upstream/icm-contracts/`:

- **`sources.json`** pins the repositories (icm-contracts and the three
  submodules the contracts import from: OpenZeppelin's contracts and
  upgradeable contracts `v5.0.2`, subnet-evm `v0.7.9`), each by commit and
  mounted where a recursive clone puts it, and lists the 36 source files the
  build reads with the git blob id each has at that commit.
- **`foundry.toml`** holds the compiler settings: solc `0.8.25` (icm-contracts'
  own pin), optimizer on with 200 runs, `cancun` (icm-contracts itself builds
  for `shanghai`; the template ships Cancun code, which uses `MCOPY`) and the
  remappings, written out with forge's guessing turned off.

`scripts/upstream.mjs` lays those files out as a checkout would, fetching each
from `raw.githubusercontent.com` at its commit and refusing any whose blob id
is not the pinned one, so the build can read nothing else. Fetched files are
cached by blob id (`$AVAKIT_UPSTREAM_CACHE`, by default
`<tmpdir>/avakit-upstream-sources`) and checked again on every read, so only the
first run needs the network.

To move to another release: change the commit (and tag) of the first
repository in `sources.json`, then

```bash
node scripts/upstream.mjs pin icm-contracts   # submodule commits + file list
pnpm biome format --write contracts-ci/upstream
node scripts/check-artifacts.mjs --write      # rebuild the three entries
```

`pin` reads GitHub's API (set `GITHUB_TOKEN` if its anonymous rate limit is in
the way); review what changed in the contracts before committing the result.

The three entries used to be a build nobody could repeat: they were compiled by
hand in July 2026 with source paths that were not recorded, and checked again by
hand since. Rebuilt from the pinned sources, their code was the same byte for
byte, and so was their ABI apart from the order of its items and keys; only the
metadata hash at the end of each differed, since it hashes those paths. The
entries now hold this build, so all of every entry is checked.

## Toolchain

Foundry pinned to the same stable version locally and in CI (see
`.github/workflows/ci.yml`). The compiler is pinned in `foundry.toml`: solc
version, EVM version (`cancun`, supported on Avalanche since the Etna upgrade)
and optimizer settings. Each of them is part of the metadata hash at the end
of the bytecode, so the EVM version is spelled out instead of left to Foundry's
default, which changes between releases.

The pin matters beyond the tests. Every template that ships a contract, and
`examples/web3auth-demo`, has its own `contracts/foundry.toml`, because a
scaffolded app has to compile on its own; `scripts/sync.mjs` fails unless each
of them carries exactly the compiler settings of this harness (only the
directory layout may differ). That is what makes one statement true for the
whole repo: the bytecode the tests run against, the bytecode `forge build`
produces in a scaffolded app and the bytecode in the shipped artifacts are the
same compiler output. Changing a setting means changing it in every
`foundry.toml` and regenerating the artifacts in the same commit.

The upstream contracts are the one exception: they are built with the
compiler their own project pins, from `upstream/icm-contracts/foundry.toml`,
which `scripts/sync.mjs` leaves alone (see [Upstream contracts](#upstream-contracts)).
