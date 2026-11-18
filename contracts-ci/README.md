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
```

- **`scripts/sync.mjs`** copies each template contract into `src/` and fails if
  templates that ship the same contract have drifted apart (`erc20-token` /
  `l1-launch` share `AvaKitToken.sol`; `nft-mint` / `token-gated-app` share
  `AvaKitNFT.sol`). `src/` is generated — never edit it here; edit the template
  copies (both of them) instead. It also fails if any `foundry.toml` in the
  repo compiles with different settings than this harness (see Toolchain).
- **`test/`** covers mint/transfer/allowance for the token; mint, the ERC-721
  transfer and approval surface and the on-chain `tokenURI` (unchanged by
  transfers, labelled with the chain it is on) for the NFT; and send/receive
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
  which has to be the `nft-mint` template's), and the example app's
  (`examples/web3auth-demo/lib/nft-artifact.ts`). It also fails on any
  `*-artifact.ts` in the repo that it has not been told about, so a new
  artifact cannot land unchecked.

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

## Toolchain

Foundry pinned to the same stable version locally and in CI (see
`.github/workflows/ci.yml`). The compiler is pinned in `foundry.toml`: solc
version, EVM version (`cancun`, what Avalanche has run since the Etna upgrade)
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
