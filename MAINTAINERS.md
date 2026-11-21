# Maintainers

AvaKit has one maintainer, [@mericcintosun](https://github.com/mericcintosun). The bus
factor is 1: no second person reviews changes, holds the release keys or can keep the
hosted services running.

## What the maintainer holds

- **The repository.** Write access, and the review of every pull request. Besides the
  maintainer, the only check on a change is CI (`.github/workflows/ci.yml`, summed up by
  its "CI passed" job), plus CodeQL and the secret scan.
- **The npm packages.** `@avakit/core`, `@avakit/react`, `@avakit/mcp`, `@avakit/studio`
  and `create-avalanche-app` each have one npm owner, the maintainer.
- **The hosted pieces.** The avakit.dev site (Vercel), and the shared Fuji faucet and the
  telemetry collector (the Cloudflare Workers in `services/`), including the faucet's
  testnet AVAX and its signing key, which is a Worker secret.

## How a release is published

Not from a laptop. Changesets versions the packages, and `.github/workflows/release.yml`
publishes them through npm trusted publishing (OIDC): there is no npm token among the
repository's secrets, and every tarball carries a provenance attestation that ties it to
the workflow run that built it. [`RELEASING.md`](RELEASING.md) has the steps.

## Adding a second maintainer

Someone becomes a maintainer after a record of work here: several merged pull requests
over a few months (code, templates or docs), reviews of other people's pull requests,
and agreement with [`CONTRIBUTING.md`](CONTRIBUTING.md) and the key rules in
[`SECURITY.md`](SECURITY.md). The current maintainer proposes it in a public issue, and
then:

1. gives them write (or maintain) access to the repository and adds them to
   [`.github/CODEOWNERS`](.github/CODEOWNERS) and to this file;
2. adds them as a reviewer of the repository's deployment environments, so a release
   or a Worker deploy can be approved by either of the two;
3. makes them an owner of each npm package, so no package depends on one account
   (publishing still goes through the release workflow only);
4. gives them access to the Cloudflare account that runs the Workers and to the Vercel
   project of the site;
5. turns on "require a review from a code owner" in the main branch ruleset. With one
   maintainer that rule would block every change, because GitHub does not let the
   author of a pull request approve it.

## If the maintainer disappears

- **The code stays usable.** It is MIT licensed ([`LICENSE`](LICENSE)): anyone may fork
  it, change it and publish it under new package names. The history, the docs and the
  issues stay public here.
- **Published versions keep installing.** What is on npm stays on npm.
- **The hosted pieces stop when their accounts lapse:** avakit.dev, the shared faucet and
  the telemetry collector. Nothing depends on them. When the faucet refuses, the apps and
  the MCP server say why and point to the official Fuji faucet;
  `NEXT_PUBLIC_AVAKIT_FAUCET_URL` points an app at a faucet of its own (the source is
  [`services/faucet`](services/faucet)). The scaffolder's anonymous telemetry never
  blocks a scaffold (it gives up after 1.5 seconds) and switches off with
  `--no-telemetry`, `AVAKIT_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.
- **Security reports** sent through GitHub's private vulnerability reporting reach the
  maintainer only (see [`SECURITY.md`](SECURITY.md)). If one goes unanswered, a fork is
  the way to ship the fix.
