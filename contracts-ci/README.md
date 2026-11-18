# contracts-ci

Repo-only Foundry harness for the Solidity the templates ship. It is not part
of any npm package and nothing here reaches users — templates stay
zero-dependency ("compiles out of the box with `forge build`"); this directory
exists so CI can actually compile and test that Solidity.

## What runs

```bash
cd contracts-ci
node scripts/sync.mjs              # copy template contracts into src/ + copy-identity check
forge test                         # compile (pinned solc) + run the test suite
node scripts/check-artifacts.mjs   # shipped abi + bytecode still match the source
```

- **`scripts/sync.mjs`** copies each template contract into `src/` and fails if
  templates that ship the same contract have drifted apart (`erc20-token` /
  `l1-launch` share `AvaKitToken.sol`; `nft-mint` / `token-gated-app` share
  `AvaKitNFT.sol`). `src/` is generated — never edit it here; edit the template
  copies (both of them) instead.
- **`test/`** covers mint/transfer/allowance for the token, mint + on-chain
  `tokenURI` for the NFT, and send/receive (incl. the Teleporter caller check)
  for the ICM messenger.
- **`test/TestBase.sol`** inlines the few Foundry cheatcodes the tests need
  instead of pulling in forge-std — the same zero-dependency spirit as the
  contracts themselves.
- **`scripts/check-artifacts.mjs`** rebuilds every contract and fails if a
  shipped artifact no longer matches the source it is generated from: each
  template's `lib/*-artifact.ts`, and the messenger bytecode Studio deploys
  (`packages/studio/src/messenger-artifact.ts`, where the `*_SIG` constants
  Studio calls the contract with are checked against its ABI too).

`examples/web3auth-demo` ships a different, simpler `AvaKitNFT` on purpose; it
is an example app, not a template, and is not covered here.

## Editing a contract

1. Edit the template's `contracts/src/*.sol` — both copies when two templates
   share the contract.
2. `node scripts/sync.mjs && forge test`
3. `node scripts/check-artifacts.mjs --write` regenerates the abi + bytecode of
   every artifact built from that contract, in place. Commit them with the
   source change; CI fails on any artifact left behind.

## Toolchain

Foundry pinned to the same stable version locally and in CI (see
`.github/workflows/ci.yml`), solc pinned in `foundry.toml`. The pin matters
beyond the tests: `lib/*-artifact.ts` bytecode is compared against this exact
compiler's output, so bumping the pin means regenerating the artifacts in the
same commit.
