# Signer, retry and dependency failures

How AvaKit fails, in two parts: what the versions on npm do today, and what is on `main` and ships in the next release. Each row is tested in the repository. Last updated 2026-11-21.

## On npm today

create-avalanche-app 0.4.3, @avakit/core 0.2.2, @avakit/react 0.2.2, @avakit/mcp 0.2.1 and @avakit/studio 0.1.14.

### Signer

| Failure | What happens |
|---|---|
| No signer on the agent path | On Fuji the MCP server creates a test wallet in memory. It is never on disk and never shown to the model. The server funds it from the faucet only when it cannot pay, and names it in every result. Any other chain is refused. `AVAKIT_TEST_WALLET=0` turns it off. |
| Mainnet requested | Refused unless three things hold: the call passes `confirm: true`, the server was started with `AVAKIT_ALLOW_MAINNET=1`, and the user supplied their own key. The variable is read from the server's own environment, so no tool call can set it. |
| The browser's temporary wallet meets the wrong network | It refuses every chain not marked as a testnet, and C-Chain (43114) whatever the label says. It also checks before the first transaction on a chain: it asks the node which chain it serves. Every signature is bound to the definition's chain id. A testnet label on a mainnet RPC therefore gets a refusal, not a mainnet transaction. |
| The wallet changes account or network, or rejects | Apps follow the wallet's events. In all eight templates, raw errors become one plain sentence. |

### Retry

| Failure | What happens |
|---|---|
| A deployment reverts | Before @avakit/core 0.2.2 this was reported as success. Now a deployment counts only with a successful receipt and code at the address. |
| A call would revert | On the agent path, every call and deployment is simulated first: the revert reason comes back and nothing is sent. In apps, the wallet's gas estimate does that job, and a transaction that reverts on chain is reported as an error. |
| A transaction is slow, or its answer is lost (agent path) | Each wallet sends one transaction at a time, with the right next nonce even when the node lags. A lost answer is looked up by hash. A transaction not mined within 60 seconds is reported as pending, with its hash and the contract's future address. Nothing is sent twice. |
| The faucet refuses, is empty or does not answer | The error is typed. Only retryable cases are retried, at most three attempts with backoff. Then the reason appears on screen with a retry button and the official faucet link. There is never a silent wait. |
| RPC error or timeout | Three retries with backoff, and a 10-second limit on every call. Each chain has one RPC endpoint. |

### Dependencies

| Failure | What happens |
|---|---|
| pnpm missing, or the install fails | The CLI uses the package manager that launched it, npm by default, and checks every command. A failure exits non-zero with the manual steps. Before create-avalanche-app 0.4.2 it printed "Done" and exited 0 with nothing installed. |
| Old Node.js | The scaffolder needs Node.js 22 or newer. On an older one it stops with one line before creating anything. Node.js 22, 24 and 26 are tested. |
| First start of the MCP server | The server is published as one bundled file whose only dependency is the scaffolder. A first start installs 48 packages instead of about 150, and takes about 5 seconds instead of 34 on an empty npm cache. Claude Code waits 30 seconds. CI and the release job install the packed server on an empty cache before anything is published. |
| Dependencies drift | Templates pin their direct dependencies, and CI fails when two templates disagree. The daily clean-machine run caught one case on 19 November: the social login SDK pulls in vitest, whose peer dependencies crashed npm 10, the npm that ships with Node.js 22. Apps now ship a one-line `.npmrc` that avoids it. The fix was released the same day, and the run is green on Node.js 22, 24 and 26. |

## On `main`, in the next release

None of this is on npm yet.

| Failure | What happens |
|---|---|
| Ava Labs' public RPC stops answering | @avakit/core moves on to the chain's next endpoint at once, but only when an endpoint fails the request: no answer, no answer in time, an HTTP error, or a node that says it cannot serve it now. Fuji and C-Chain fall back to PublicNode, and a custom chain can list its own endpoints in `rpcUrls`. Every request still gives up after 10 seconds, and the whole list is retried three times with backoff. A node's answer about the request itself, such as a revert or "nonce too low", comes back as the node gave it and is never sent elsewhere. When every endpoint fails, the call rejects with `RpcEndpointsError`, which names each endpoint by its origin and says how it failed. The MCP server bundles core, so it gets this too. |
| The temporary wallet's node stops answering | The wallet sends each transaction through one endpoint whose node has confirmed the chain. A send never moves to another node halfway and is never sent twice; the next send moves on to the next endpoint. A fallback node that names another chain is refused like the first one. A refusal names an endpoint by its origin, never a password or API key in its URL. |
| An agent is steered to another contract, or to send AVAX | The MCP server's `write_contract` calls only the contracts the server deployed in its session or that `AVAKIT_WRITE_ALLOWLIST` lists. One call sends at most `AVAKIT_MAX_VALUE` AVAX (0.1 by default). Both come from the server's environment and are checked again when the transaction is signed. They hold per call. |
| Studio signs on the local devnet | Studio signs its Interchain transactions in its own process, with the public EWOQ devnet key, only for an RPC on this machine that answers for the L1's recorded chain ID. The key is on no command line. Stopping Studio stops the avalanche-cli command it started. |
| The eERC template's upstream changes | It is pinned to upstream's security fixes of 2026-08-31, so `npm run deploy:eerc` deploys verifiers that match the circuits the app proves with. At the old pin, that script failed on a clean machine, or would have deployed verifiers that reject every real proof. CI checks the pin. |
| A template needs Avalanche CLI | `icm-messenger`, `l1-launch` and `token-bridge` are marked experimental. The wizard, a non-interactive run, `--help` and the MCP server's `list_templates` say so. Studio labels its Avalanche CLI views the same way. |
| Old Node.js | Every package declares Node.js 22 or newer, not only the scaffolder, and CI checks that this is the oldest Node.js it tests on. |

The faucet Worker is deployed apart from npm. Its code on `main` adds a daily drip budget and a kill switch, with two new refusals: `429 daily_limited` and `503 faucet_paused`. They take effect when the hosted faucet is next deployed. @avakit/core 0.2.2 reads them by their status alone, as a rate limit and as an empty faucet, and retries neither. From the next release, @avakit/core reports a pause as `code: "paused"`, not as an empty faucet, and the MCP server says either that the faucet is paused or that its daily limit is reached and when it resets.

## Still open

See [KNOWN-GAPS.md](../KNOWN-GAPS.md):

- The RPC fallback and the MCP write limits are on `main`, not on npm, and avakit.dev still uses @avakit/core 0.2.2 with one endpoint.
- The MCP write limits hold per call. Daily caps, allowlists of methods, human confirmation and an audit log are deliverable D1 of [milestone.md](milestone.md).
- The three Avalanche CLI templates were last proven end to end in July.
- Browser tests now drive avakit.dev/new and a scaffolded `nft-mint` app on every pull request ([`apps/web/e2e`](../../apps/web/e2e), run by [`e2e-browser.yml`](../../.github/workflows/e2e-browser.yml)). No test signs in with Google, and the other templates are built in CI but not clicked through.
- The hosted faucet does not run the daily budget and kill switch yet. Its deploy waits for an owner step: adding the Cloudflare API token to the deploy workflow's environment.
