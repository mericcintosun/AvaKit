# @avakit/mcp

The [AvaKit](https://github.com/mericcintosun/AvaKit) MCP server — scaffold, deploy, mint, and read Avalanche from Claude Code / Cursor over the [Model Context Protocol](https://modelcontextprotocol.io).

Avalanche's official MCP server is read-only: it looks things up and never signs. This one also performs **write actions** — it creates a dapp, deploys a contract and sends contract calls — on a testnet, behind explicit gates: a wallet that can only sign for Fuji, and three separate requirements before anything touches mainnet.

Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io) as **`dev.avakit/avalanche`**.

## Add to your MCP client

Claude Code:

```bash
claude mcp add avakit -- npx -y @avakit/mcp
```

Cursor, Claude Desktop and other clients that read a JSON config:

```json
{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"]
    }
  }
}
```

## Zero setup on Fuji

With the server added, paste this to your agent in an empty folder:

> Create an NFT app called my-first-dapp with AvaKit, deploy its contract to Fuji and mint the first NFT. Give me the explorer links.

That is three tool calls, and the agent does not read or copy a single file:

1. `scaffold_app({ name: "my-first-dapp", template: "nft-mint" })` creates the project and returns `artifacts: ["my-first-dapp/lib/nft-artifact.ts"]`.
2. `deploy_contract({ artifactPath: "my-first-dapp/lib/nft-artifact.ts" })` returns the contract's `address` and its explorer link.
3. `write_contract({ address, artifactPath: "my-first-dapp/lib/nft-artifact.ts", functionName: "mint" })` returns the mint transaction's explorer link.

You created no key, funded no wallet and set no environment variable. This is what happened instead.

### The session test wallet

When `AVAKIT_DEPLOYER_KEY` is not set, `deploy_contract` and `write_contract` sign Fuji transactions with a wallet the server makes for itself the first time it needs one. It is deliberately the weakest wallet that can do that job:

- **Memory only.** The key is generated inside the server process. It is never written to disk, never logged, never returned by a tool and never part of an error message — only the address is shown. When the server stops the wallet is gone, along with whatever test AVAX was left in it.
- **Fuji only.** It refuses to sign for any other chain. Mainnet never uses it: see [Mainnet](#mainnet).
- **Gas only.** It never sends AVAX with a transaction, so it cannot be used to move the faucet's money somewhere else.

Every result of a signing tool says who signed — `signer: { address, source }`, with `source` `"session"` for this wallet and `"env"` for your own key — and adds a one-line `note` when it was the session wallet. `wallet_status` shows the wallet and its balance without sending anything.

### The faucet, and its limits

A new wallet is empty. Before it sends, if the session wallet cannot pay for the transaction, the server asks the AvaKit faucet (`https://avakit-faucet.avakit.workers.dev/fund`) for one drip of test AVAX and waits up to about 30 seconds for it to arrive. The faucet's limits are enforced on its side; at the time of writing:

- one drip per wallet per 24 hours, of 0.02 AVAX — enough for the deploy and the mint above at Fuji's usual fees, and not enough when fees are many times higher;
- 20 drips per hour from one network address, shared by everyone behind it;
- it can run empty.

When the faucet says no, **nothing is sent**, and the tool returns the faucet's reason and the two ways forward:

1. set `AVAKIT_DEPLOYER_KEY` to your own funded Fuji key, or
2. get test AVAX from the official faucet at <https://build.avax.network/console/primary-network/faucet> (it needs a free Builder Hub sign-in) for the session wallet's address, and call the tool again while the server is still running.

The faucet is asked again only when the answer could be different: after a network error, or a 5xx other than 503 — three attempts in all, ten seconds each, with a growing randomised pause between them. A refusal (429, 503, 4xx) is an answer and is not retried.

### Turning it off, or using your own key

- `AVAKIT_TEST_WALLET=0` in the server's environment turns the session wallet off. The signing tools then ask for `AVAKIT_DEPLOYER_KEY`, as they did before it existed.
- `AVAKIT_DEPLOYER_KEY` is used instead of the session wallet whenever it is set: see [Your own key](#your-own-key). The faucet is never asked to fund a key of yours.

## Tools

| Tool | Description |
| --- | --- |
| `scaffold_app` | Create an Avalanche dapp from any of the 8 templates (`list_templates` returns the current set). The result lists `artifacts`, the paths of the project's compiled contracts |
| `list_templates` | List available templates, with the chains each one supports |
| `read_chain` | Read a balance, a transaction receipt, or a contract view function |
| `deploy_contract` | Deploy a compiled contract, given as `artifactPath` or as `abi` + `bytecode`. No key needed on Fuji; mainnet needs your own key, `confirm: true` **and** `AVAKIT_ALLOW_MAINNET=1` in the server's environment |
| `write_contract` | Send a state-changing contract call — mint, transfer, approve — after simulating it. Signs the way `deploy_contract` does |
| `wallet_status` | Show which wallet would sign on a chain, where it comes from, and its balance. Sends nothing |
| `estimate_gas` | Estimate gas for a call before you send it |
| `get_context` | AvaKit + Avalanche coding context and doc links |

Every tool takes a strict set of arguments: one it does not declare is rejected, not ignored. Each also carries MCP annotations, so a client can ask you before a write: the two signing tools are marked as not read-only and as reaching outside your machine, `scaffold_app` as writing locally, and the rest as read-only.

## Deploying and calling contracts

### Contracts by file: `artifactPath`

The nft-mint template's bytecode is 15,422 hex characters. Rather than have an agent copy that into a tool call, `deploy_contract` and `write_contract` take the path of the artifact file. Two shapes are read:

1. a JSON file with `abi` and `bytecode`, where `bytecode` is a `0x` hex string (Hardhat) or `{ "object": "0x…" }` (Foundry) — for example `contracts/out/Counter.sol/Counter.json` after `forge build`;
2. an AvaKit template artifact module such as `lib/nft-artifact.ts`, with `export const abi = [ … ]` in the compiler's JSON form and `export const bytecode = "0x…"`.

The file is read as text and never run. The path is relative to the server's working directory and must stay inside it — the same rule, and the same `AVAKIT_MCP_ROOT` override, as [where projects are created](#scaffolding). Only regular files of up to 2 MB are read, and a file that is not an artifact is refused without any of its contents being quoted back.

`scaffold_app` returns the artifact paths of the project it created as `artifacts`, so an agent has them without looking.

An ABI can also be passed inline as `abi`: the compiler's JSON array, or just the signatures you need, such as `["function mint() returns (uint256)"]`.

### `deploy_contract`

| Argument | |
| --- | --- |
| `artifactPath` | The artifact file. Instead of `abi` + `bytecode` — exactly one of the two forms |
| `abi`, `bytecode` | The ABI (JSON, or signatures such as `["constructor(address owner)"]`) and the creation bytecode |
| `args` | Constructor arguments, in order |
| `chain` | `"fuji"` (default) or `"c-chain"` |
| `confirm` | `true` is required on mainnet; see [Mainnet](#mainnet) |

Returns `{ address, txHash, explorerUrl, signer: { address, source }, note? }`.

The address is returned only once the transaction has been mined, its status is success **and** there is code at the address. Each of the three has been seen to be false on its own, and each is reported as an error rather than as a deployed contract.

### `write_contract`

| Argument | |
| --- | --- |
| `address` | The contract. All lowercase, or with a valid checksum |
| `functionName` | For example `"mint"`. To pick between overloads, the full signature: `"safeTransferFrom(address,address,uint256)"` |
| `abi` or `artifactPath` | The ABI — exactly one of the two |
| `args` | The function's arguments, in order |
| `value` | Wei to send with a payable call, as a decimal string. Only with your own key, and only on Fuji |
| `chain`, `confirm` | As for `deploy_contract` |

Returns `{ txHash, status: "success", blockNumber, explorerUrl, signer: { address, source }, note? }`. `blockNumber` is a decimal string, like every large number these tools return.

The call is simulated first. If it would revert, the revert reason comes back as an error and nothing is sent — no transaction, no gas. A view function is refused with a pointer to `read_chain`, and an address with no contract at it is refused too: a call to an empty account is mined and "succeeds" having done nothing.

Pass integers that do not fit a JSON number (anything from about 9 × 10¹⁵ up — most token amounts) as decimal strings: `"1000000000000000000"`. A JSON number that has already lost digits is refused, not encoded.

### `wallet_status`

Takes `chain` (`"fuji"` by default). Returns `{ address, source, chain, balanceWei, balanceAvax, note? }`, where `source` is `"session"`, `"env"` or `"none"`. On Fuji with no key it creates the session wallet if it does not exist yet and reports it; a zero balance there is normal, because the signing tools fund it when it cannot pay. It never asks the faucet for anything. On mainnet without `AVAKIT_DEPLOYER_KEY` the source is `"none"` and the address and balances are `null`.

### When something fails

The messages are written to answer the question that comes next: was anything sent?

| What went wrong | What the tool does |
| --- | --- |
| No key, and the session wallet cannot be used (mainnet, or `AVAKIT_TEST_WALLET=0`) | Refuses before contacting anything, naming `AVAKIT_DEPLOYER_KEY` |
| `AVAKIT_DEPLOYER_KEY` is not a valid key | Refuses, without repeating the value |
| The wallet cannot pay | Your own key: refuses with the balance and the amount needed. Session wallet: asks the faucet once, as described above |
| The RPC cannot be reached, or answers as another chain | Refuses before signing: "nothing was sent" |
| The transaction would revert | Returns the revert reason; nothing is sent |
| The node rejects the transaction | Returns the node's reason: "nothing was sent" |
| The connection drops while sending | Asks the node whether it has the transaction (its hash is known beforehand) and carries on if it does; otherwise says that it is not certain, with the hash to check |
| The transaction is not mined within 60 seconds | Reports it as sent but not confirmed, with the hash and a link, and never sends it again — so a retry cannot deploy or mint twice |
| The transaction is mined but reverted | An error with the transaction's link, never a success |

Reads of the chain are retried a few times by the RPC client on network errors. A transaction is signed and sent once.

## Scaffolding

**Templates and chains.** `scaffold_app` takes a `chain`, `fuji` by default. A template can only
be scaffolded for the chains `list_templates` reports for it: `minimal` also supports `c-chain`
(mainnet), every other template is Fuji-only. Any other combination is refused with a message that
names the chains the template supports.

**What comes back.** The project's `path`, its `files`, `nextSteps`, and `artifacts`: the paths,
relative to the working directory, of the compiled contracts in the new project. They are what
`deploy_contract` and `write_contract` take as `artifactPath`, and `nextSteps` ends with the exact
calls. A template without a single-contract artifact of its own (`minimal`, `eerc-token`,
`token-bridge`) has none. `icm-messenger` and `l1-launch` list theirs, but their apps run on a local
network that `scaffold_app`'s next steps start, and the signing tools reach Fuji and the C-Chain
only.

**Where projects are created.** `scaffold_app` creates the project inside the directory the server
was started in — in Claude Code and Cursor, your workspace. The optional `directory` argument picks
a sub-directory of it. A path outside (an absolute path elsewhere, or one that climbs out with
`..`, directly or through a symlink) is refused, so an agent acting on a malicious prompt cannot
plant a project somewhere else on your disk. `artifactPath` is held to the same directory.

Claude Desktop does not start servers inside a project folder: their working directory can be `/`
(as it is on macOS), which contains the whole disk, so `scaffold_app` refuses to create anything
from there. For a client like that, or to create projects somewhere else, name the directory in
the server's environment:

```json
{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": { "AVAKIT_MCP_ROOT": "/Users/you/projects" }
    }
  }
}
```

Projects then go under `AVAKIT_MCP_ROOT` instead of the working directory, and artifact paths are
relative to it. Only whoever configures the server can set it; a tool caller cannot.

## Your own key

Set `AVAKIT_DEPLOYER_KEY` in the server's environment and `deploy_contract` and `write_contract` sign with it, on Fuji and (behind the gates below) on mainnet. It is 64 hex characters, with or without the `0x` prefix. On Fuji, use a **throwaway testnet key** — never a key holding real funds.

With your own key the tools refuse up front when it cannot pay for the transaction, and the faucet is never asked.

## Mainnet

Everything goes to Fuji unless a call asks for `chain: "c-chain"`. A mainnet deploy or contract call needs **three** things, and is refused unless all are present:

1. your own key in `AVAKIT_DEPLOYER_KEY` — the session test wallet is never used on mainnet;
2. `confirm: true` in the tool call; and
3. `AVAKIT_ALLOW_MAINNET=1` in the environment the server runs in.

`confirm: true` alone is not enough, on purpose. An agent can be talked into passing it by a
prompt-injected instruction, but it cannot change the environment of the server process — so a
malicious prompt on its own can never spend real funds. The refusal names the variable, so you
will see what is missing. `write_contract` never sends AVAX with a call on mainnet.

```json
{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": {
        "AVAKIT_DEPLOYER_KEY": "<the key to sign with>",
        "AVAKIT_ALLOW_MAINNET": "1"
      }
    }
  }
}
```

Leave `AVAKIT_ALLOW_MAINNET` unset for everyday testnet work, and set it only alongside a key you
are prepared to spend from.

## Environment variables

All optional, and all read from the environment of the server process — none of them can be set by
a tool call.

| Variable | What it does |
| --- | --- |
| `AVAKIT_DEPLOYER_KEY` | Your own private key for `deploy_contract` and `write_contract`. Unset, they use the session test wallet on Fuji and refuse on mainnet. The other tools need no key. |
| `AVAKIT_TEST_WALLET` | Set to `0` to turn the session test wallet off, so nothing is signed without `AVAKIT_DEPLOYER_KEY`. |
| `AVAKIT_FAUCET_URL` | Another deployment of the AvaKit faucet for the session wallet to ask, instead of the hosted one. |
| `AVAKIT_ALLOW_MAINNET` | Set to `1` to allow mainnet transactions (which also need your own key and `confirm: true`). Unset, the server is testnet-only. |
| `AVAKIT_MCP_ROOT` | The directory `scaffold_app` creates projects in and `artifactPath` reads from, instead of the server's working directory. Needed when the server is started in the filesystem root. |

MIT © AvaKit contributors
