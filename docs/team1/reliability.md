# Signer, retry and dependency failures

How AvaKit fails today, in the versions on npm: create-avalanche-app 0.4.3, @avakit/core 0.2.2, @avakit/react 0.2.2 and @avakit/mcp 0.2.1. Each row is tested in the repository.

## Signer

| Failure | What happens |
|---|---|
| No signer on the agent path | On Fuji the MCP server creates a test wallet in memory. It is never on disk and never shown to the model. The server funds it from the faucet only when it cannot pay, and names it in every result. Any other chain is refused. `AVAKIT_TEST_WALLET=0` turns it off. |
| Mainnet requested | Refused unless three things hold: the call passes `confirm: true`, the server was started with `AVAKIT_ALLOW_MAINNET=1`, and the user supplied their own key. The variable is read from the server's own environment, so no tool call can set it. |
| The browser's temporary wallet meets the wrong network | It refuses every chain not marked as a testnet, and C-Chain (43114) whatever the label says. It also checks before the first transaction on a chain: it asks the node which chain it serves. Every signature is bound to the definition's chain id. A testnet label on a mainnet RPC therefore gets a refusal, not a mainnet transaction. |
| The wallet changes account or network, or rejects | Apps follow the wallet's events. In all eight templates, raw errors become one plain sentence. |

## Retry

| Failure | What happens |
|---|---|
| A deployment reverts | Before @avakit/core 0.2.2 this was reported as success. Now a deployment counts only with a successful receipt and code at the address. |
| A call would revert | On the agent path, every call and deployment is simulated first: the revert reason comes back and nothing is sent. In apps, the wallet's gas estimate does that job, and a transaction that reverts on chain is reported as an error. |
| A transaction is slow, or its answer is lost (agent path) | Each wallet sends one transaction at a time, with the right next nonce even when the node lags. A lost answer is looked up by hash. A transaction not mined within 60 seconds is reported as pending, with its hash and the contract's future address. Nothing is sent twice. |
| The faucet refuses, is empty or does not answer | The error is typed. Only retryable cases are retried, at most three attempts with backoff. Then the reason appears on screen with a retry button and the official faucet link. There is never a silent wait. |
| RPC error or timeout | Three retries with backoff, and a 10-second limit on every call. |

## Dependencies

| Failure | What happens |
|---|---|
| pnpm missing, or the install fails | The CLI uses the package manager that launched it, npm by default, and checks every command. A failure exits non-zero with the manual steps. Before create-avalanche-app 0.4.2 it printed "Done" and exited 0 with nothing installed. |
| Old Node.js | The scaffolder needs Node.js 22 or newer. On an older one it stops with one line before creating anything. Node.js 22, 24 and 26 are tested. |
| First start of the MCP server | The server is published as one bundled file whose only dependency is the scaffolder. A first start installs 48 packages instead of about 150, and takes about 5 seconds instead of 34 on an empty npm cache. Claude Code waits 30 seconds. CI and the release job install the packed server on an empty cache before anything is published. |
| Dependencies drift | Templates pin their direct dependencies, and CI fails when two templates disagree. The daily clean-machine run caught one case this week: the social login SDK pulls in vitest, whose peer dependencies crashed npm 10, the npm that ships with Node.js 22. Apps now ship a one-line `.npmrc` that avoids it. The fix was released the same day, and the run is green on Node.js 22, 24 and 26. |

## Still open

See [KNOWN-GAPS.md](../KNOWN-GAPS.md):

- Each chain has one RPC endpoint and no fallback.
- The three Avalanche CLI templates were last proven end to end in July.
- No test drives a browser.
