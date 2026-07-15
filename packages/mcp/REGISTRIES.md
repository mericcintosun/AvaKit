# Listing `@avakit/mcp` on the MCP registries

Why this matters: the official Avalanche MCP surface is **docs-retrieval only**. Ours
acts — scaffold, deploy, mint, estimate gas, read chain. Being findable in the places
agents look is the whole point (see `docs/strategy/execution-plan.md`, W5).

## Status

| Registry | Status | Entry |
| --- | --- | --- |
| **Official MCP Registry** | **live** | `dev.avakit/avalanche` |
| awesome-mcp-servers | PR open | [#10168](https://github.com/punkpeye/awesome-mcp-servers/pull/10168), Developer Tools |
| Smithery | needs an account | `smithery.yaml` is committed at the repo root |
| mcp.so | needs an account | submit at [mcp.so](https://mcp.so) |
| Glama | needs an account | form-based; auto-crawls, but "claimed" tier needs owner verification |

## The official registry

The listing is `packages/mcp/server.json`. Two rules the registry enforces, both of
which will bite you:

1. **`server.json`'s `name` must equal `mcpName` in `packages/mcp/package.json`**, and
   the registry checks `mcpName` on the **package published to npm** — not the repo. So
   a listing change that touches `mcpName` needs a **release first**, or publishing
   fails with *"NPM package is missing required 'mcpName' field"*.
2. **`server.json`'s `version` must match the published npm version**, and
   `description` is capped at **100 characters** (a longer one 422s).

### Publishing an update

```bash
brew install mcp-publisher
cd packages/mcp

# Ownership of the dev.avakit namespace is proven by the public key at
# apps/web/public/.well-known/mcp-registry-auth, which avakit.dev serves.
# The private half is at ~/.avakit/mcp-registry-key.pem — outside this repo,
# never in CI. Back it up; without it you cannot update the listing.
PRIV="$(openssl pkey -in "$HOME/.avakit/mcp-registry-key.pem" -noout -text \
        | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain avakit.dev --private-key "$PRIV"

mcp-publisher validate     # catches the 100-char description and schema errors
mcp-publisher publish
```

Tokens expire quickly — if `publish` 401s with *"token is expired"*, log in again.

### Why HTTP auth and not GitHub or DNS

- **GitHub auth** would force the name `io.github.mericcintosun/*` — a personal handle
  in every agent's tool list.
- **DNS auth** works but needs a TXT record on `avakit.dev` (Cloudflare), i.e. a
  credential and a console step outside this repo.
- **HTTP auth** gives the same `dev.avakit/*` namespace, and the proof is a file in
  `apps/web/public/.well-known/` that Vercel serves — version-controlled, reviewable,
  and it costs CI nothing. Registry publishes are rare enough to stay manual, which
  keeps the release pipeline token-free (see `RELEASING.md`).

### Name the server for what people search

**Registry search matches names, not descriptions.** Measured: a word appearing only
in our description returned **zero** results, while a word in the name returned the
entry. The server was briefly published as `dev.avakit/avafox` and was invisible to
`search=avalanche` — the one query the listing exists to win, and the query where the
docs-only competitor was the only hit. Renamed to `dev.avakit/avalanche`; the old entry
is `deleted`. If you ever rename again, check the search before assuming it worked.

## The account-gated ones

These need a human with an account; nothing else is blocking them.

- **Smithery** — `smithery.yaml` (repo root) is already in the shape Smithery expects:
  stdio, `npx -y @avakit/mcp`, one optional `avakitDeployerKey`. Sign in at
  [smithery.ai](https://smithery.ai) with GitHub, connect this repo, and it reads that file.
- **mcp.so** — submit the repo + `npx -y @avakit/mcp`.
- **Glama** — [glama.ai](https://glama.ai/mcp) crawls public repos on its own, so the
  server may appear without any action; the useful step is **claiming** it so it leaves
  the anonymous-crawl tier. Glama also mints the score badge that
  awesome-mcp-servers entries carry — worth adding to our entry once we have one.
