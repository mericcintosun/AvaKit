# @avakit/mcp

The [AvaKit](https://github.com/mericcintosun/AvaKit) MCP server — scaffold, deploy, mint, and read Avalanche from Claude Code / Cursor over the [Model Context Protocol](https://modelcontextprotocol.io).

Avalanche's official MCP server is read-only: it looks things up and never signs. This one also performs **write actions** — it creates a dapp, deploys a contract and sends contract calls — on a testnet, behind explicit gates: a wallet that can only sign for Fuji, three separate requirements before anything touches mainnet and, from 0.3.0, contract calls only to the contracts it deployed itself or that you list and a limit on the AVAX one call can send. (0.2.1 and earlier call any contract and, with your own key on Fuji, send any value.)

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

## First start

A client only waits so long for a server to connect — 30 seconds in Claude Code — and the first `npx -y @avakit/mcp` on a machine has to download the server before it can start it. To keep that download small, the server is published as one file with its libraries (the MCP SDK, viem, zod and `@avakit/core`) inside it, and has a single dependency: `create-avalanche-app`, which holds the templates.

- **The first start** on an empty npm cache downloads 48 packages, 28 MB on disk — the server, `create-avalanche-app`, and what its interactive wizard needs. On a fast connection that took 2 to 4 seconds, and the server answered a client 0.1 to 0.2 seconds after it was started. The repository's `scripts/smoke-mcp.sh` measures this, on a real install with an empty cache, in every CI run. Up to 0.1.27 a first start downloaded about 150 packages, 122 MB, and was measured at 34 seconds on a busy machine: longer than a client waits.
- **Every later start** downloads nothing: `npx` finds the server in npm's cache.
- **On a slow network**, download the server before you add it to a client. In a terminal, run

  ```bash
  npx -y @avakit/mcp --version
  ```

  It downloads the same files, prints the version and exits; the client then starts the server from the cache. Do the same if a client reports that the server timed out while connecting, then reconnect it.

`npx -y @avakit/mcp --help` prints a short description of the server, its tools and its environment variables. With any other argument, or none, it starts the server on standard input and output, which is what a client does.

## Zero setup on Fuji

With the server added, paste this to your agent in an empty folder:

> Create an NFT app called my-first-dapp with AvaKit, deploy its contract to Fuji and mint the first NFT. Give me the explorer links.

That is three tool calls, and the agent does not read or copy a single file:

1. `scaffold_app({ name: "my-first-dapp", template: "nft-mint" })` creates the project and returns `artifacts: ["my-first-dapp/lib/nft-artifact.ts"]`.
2. `deploy_contract({ artifactPath: "my-first-dapp/lib/nft-artifact.ts" })` returns the contract's `address` and its explorer link.
3. `write_contract({ address, artifactPath: "my-first-dapp/lib/nft-artifact.ts", functionName: "mint" })` returns the mint transaction's explorer link. The server calls that contract because it deployed it itself, in this session: see [Write limits](#write-limits).

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
- a daily drip budget shared by every caller;
- it can run empty, and its operator can pause it.

The daily budget and the pause have refusals of their own: `429 daily_limited` (the day's budget is spent, until 00:00 UTC) and `503 faucet_paused` (its operator has switched it off). The server names both from 0.3.0; 0.2.1 and earlier go by their HTTP status and report them as a rate limit and as an empty faucet.

When the faucet says no, **nothing is sent**, and the tool returns the faucet's reason and the two ways forward:

1. set `AVAKIT_DEPLOYER_KEY` to your own funded Fuji key, or
2. get test AVAX from the official faucet at <https://build.avax.network/console/primary-network/faucet> (it needs a free Builder Hub sign-in) for the session wallet's address, and call the tool again while the server is still running.

The request is `requestFaucet` from `@avakit/core`, and it is repeated only when the answer could be different:

- **Asked again:** no answer arrived (a network error, or nothing within ten seconds), or the faucet failed on its side — a 500, 502 or 504, a 503 in which the faucet says it is busy, or a 503 that an outage in front of the faucet answered.
- **Not asked again:** a refusal. A 429 (this wallet was funded in the last 24 hours, the limit for your network was reached, or the faucet's daily limit for all callers is spent), the faucet's own 503 for "empty" or "paused", and every 4xx are answers, and repeating the question would only use up the allowance faster. From 0.3.0, a daily limit is reported with the time until it resets, and a pause as a pause, not as an empty faucet.

That is three attempts at most, ten seconds each, with a randomised pause between them that doubles its range each time. When an attempt got no answer, the server looks at the wallet's balance for another ten seconds before giving up, because the request may have been served all the same.

### Turning it off, or using your own key

- `AVAKIT_TEST_WALLET=0` in the server's environment turns the session wallet off. The signing tools then ask for `AVAKIT_DEPLOYER_KEY`, as they did before it existed.
- `AVAKIT_DEPLOYER_KEY` is used instead of the session wallet whenever it is set: see [Your own key](#your-own-key). The faucet is never asked to fund a key of yours.

## Tools

| Tool | Description |
| --- | --- |
| `scaffold_app` | Create an Avalanche dapp from any of the 8 templates (`list_templates` returns the current set). The result lists `artifacts`, the paths of the project's compiled contracts |
| `list_templates` | List available templates, with the chains each one supports |
| `read_chain` | Read a balance, a transaction receipt, or a contract view function, given as `artifactPath` or as `abi` like `write_contract` |
| `deploy_contract` | Deploy a compiled contract, given as `artifactPath` or as `abi` + `bytecode`. No key needed on Fuji; mainnet needs your own key, `confirm: true` **and** `AVAKIT_ALLOW_MAINNET=1` in the server's environment |
| `write_contract` | Send a state-changing contract call — mint, transfer, approve — after simulating it, to a contract the server deployed in this session or one you list in `AVAKIT_WRITE_ALLOWLIST`. Signs the way `deploy_contract` does |
| `wallet_status` | Show which wallet would sign on a chain, where it comes from, and its balance. Sends nothing |
| `estimate_gas` | Estimate gas for a call before you send it |
| `get_context` | AvaKit + Avalanche coding context and doc links |

Every tool takes a strict set of arguments: one it does not declare is rejected, not ignored. Each also carries MCP annotations, so a client can ask you before a write: the two signing tools are marked as not read-only and as reaching outside your machine, `scaffold_app` as writing locally, and the rest as read-only.

## Deploying and calling contracts

### Contracts by file: `artifactPath`

The nft-mint template's bytecode is about fifteen thousand hex characters. Rather than have an agent copy that into a tool call, `deploy_contract` and `write_contract` take the path of the artifact file. Two shapes are read:

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

`address` carries its EIP-55 checksum (mixed case). `write_contract` refuses a mixed-case address whose checksum does not hold, so a character that changes while an agent copies the address from one call to the next is caught rather than called. `explorerUrl` here and in `write_contract` is built from the chain's definition in `@avakit/core`.

The address is returned only once the transaction has been mined, its status is success **and** there is code at the address. Each of the three has been seen to be false on its own, and each is reported as an error rather than as a deployed contract. The code is read up to six times over about two seconds, because a node can hand out a receipt a moment before it can show the code; if it cannot be read at all, the error says the deployment is unconfirmed and to check the address before deploying again.

### `write_contract`

| Argument | |
| --- | --- |
| `address` | The contract. All lowercase, or with a valid checksum. One the server deployed in this session, or one `AVAKIT_WRITE_ALLOWLIST` lists |
| `functionName` | For example `"mint"`. To pick between overloads, the full signature: `"safeTransferFrom(address,address,uint256)"` |
| `abi` or `artifactPath` | The ABI — exactly one of the two |
| `args` | The function's arguments, in order |
| `value` | Wei to send with a payable call, as a decimal string. Only with your own key, only on Fuji, and at most `AVAKIT_MAX_VALUE` AVAX (0.1 by default) |
| `chain`, `confirm` | As for `deploy_contract` |

Returns `{ txHash, status: "success", blockNumber, explorerUrl, signer: { address, source }, note? }`. `blockNumber` is a decimal string, like every large number these tools return.

The contract and the value are held to the [write limits](#write-limits) before anything else is asked of the chain. Then the call is simulated. If it would revert, the revert reason comes back as an error and nothing is sent — no transaction, no gas. A view function is refused with a pointer to `read_chain`, and an address with no contract at it is refused too: a call to an empty account is mined and "succeeds" having done nothing.

Pass integers that do not fit a JSON number (anything from about 9 × 10¹⁵ up — most token amounts) as decimal strings: `"1000000000000000000"`. A JSON number that has already lost digits is refused, not encoded.

### `read_chain`

| Argument | |
| --- | --- |
| `action` | `"balance"`, `"txReceipt"` or `"contractRead"` |
| `address` | The account for `balance`, the contract for `contractRead` |
| `hash` | The transaction for `txReceipt` |
| `functionName` | For `contractRead`: a view or pure function, for example `"ownerOf"`. To pick between overloads, the full signature |
| `abi` or `artifactPath` | For `contractRead`: the ABI, exactly one of the two, in the same forms as `write_contract` |
| `args` | The function's arguments, in order |
| `chain` | `"fuji"` (default) or `"c-chain"` |

Needs no key and sends nothing. A contract that `scaffold_app` created can be read with the artifact path it returned, or with one signature: `{ "action": "contractRead", "address": "0x…", "abi": ["function ownerOf(uint256 tokenId) view returns (address)"], "functionName": "ownerOf", "args": [1] }`. A state-changing function is refused with a pointer to `write_contract`.

### `wallet_status`

Takes `chain` (`"fuji"` by default). Returns `{ address, source, chain, balanceWei, balanceAvax, note? }`, where `source` is `"session"`, `"env"` or `"none"`. On Fuji with no key it creates the session wallet if it does not exist yet and reports it; a zero balance there is normal, because the signing tools fund it when it cannot pay. It never asks the faucet for anything. On mainnet without `AVAKIT_DEPLOYER_KEY` the source is `"none"` and the address and balances are `null`.

### When something fails

The messages are written to answer the question that comes next: was anything sent?

| What went wrong | What the tool does |
| --- | --- |
| No key, and the session wallet cannot be used (mainnet, or `AVAKIT_TEST_WALLET=0`) | Refuses before contacting anything, naming `AVAKIT_DEPLOYER_KEY` |
| `AVAKIT_DEPLOYER_KEY` is not a valid key | Refuses, without repeating the value |
| `write_contract` names a contract the server did not deploy in this session and `AVAKIT_WRITE_ALLOWLIST` does not list | Refuses before contacting anything, naming `AVAKIT_WRITE_ALLOWLIST`: "Nothing was signed or sent" |
| The call would send more AVAX than `AVAKIT_MAX_VALUE` allows | Refuses before contacting anything, naming `AVAKIT_MAX_VALUE` |
| `AVAKIT_WRITE_ALLOWLIST` or `AVAKIT_MAX_VALUE` cannot be read | Refuses every call that variable governs, naming it, until it is fixed |
| The wallet cannot pay | Your own key: refuses with the balance and the amount needed. Session wallet: asks the faucet once, as described above |
| The RPC cannot be reached, or answers as another chain | Refuses before signing: "nothing was sent" |
| The transaction would revert | Returns the revert reason; nothing is sent |
| The node rejects the transaction | Returns the node's reason: "nothing was sent" |
| The connection drops while sending | Asks the node whether it has the transaction (its hash is known beforehand) and carries on if it does; otherwise says that it is not certain, with the hash to check |
| The transaction is not mined within 60 seconds | Reports it as sent but not confirmed, with the hash and a link, and never sends it again — so a retry cannot deploy or mint twice |
| The transaction is mined but reverted | An error with the transaction's link, never a success |

Reads of the chain are retried a few times by the RPC client on network errors. A transaction is signed once and broadcast without retries. From 0.3.0, which bundles core's RPC fallback, the broadcast goes to the chain's RPC endpoints in `@avakit/core` in order, each at most once, and moves on to the next one only when an endpoint gives no answer or answers that it cannot serve the request now: a node that rejects the transaction ("nonce too low", "insufficient funds") is reported as above, and the transaction is not handed to another endpoint. 0.2.1 and earlier have one endpoint per chain. The same signed transaction can run at most once.

## Write limits

These limits are in the server from 0.3.0. Versions up to 0.2.1 have neither: their `write_contract` calls any contract and, with your own key on Fuji, sends any value.

An agent decides what to call, and an agent can be steered by what it reads: a README, an issue, a web page. So that a prompt-injected agent cannot point this server's wallet at any contract it likes, the two signing tools are held to two limits that come from the server's environment. A tool call cannot change either of them. Set these in your user-level MCP client config, not in a project file an agent can edit (such as `.mcp.json` or `.cursor/mcp.json`).

### Which contracts `write_contract` calls

`write_contract` calls a contract only when one of these is true:

1. **This server deployed it**, with `deploy_contract`, on the same chain, since the server started. The address is recorded as soon as the deployment is signed, so a deployment that was still pending when `deploy_contract` answered can be called once it is mined. This is all the [zero-setup flow](#zero-setup-on-fuji) needs. The record lives in the server's memory and is forgotten when the server stops, and it holds the contract a deployment created, not the contracts that contract creates in turn.
2. **`AVAKIT_WRITE_ALLOWLIST` lists it**: a comma-separated list of addresses, each all lowercase or with a valid EIP-55 checksum, for a contract deployed some other way or by an earlier run of the server. An address listed there may be called on every chain the server signs for. Some contracts, such as Permit2 and Multicall3, have the same address on every chain, so listing one for Fuji also allows it on mainnet whenever `AVAKIT_ALLOW_MAINNET=1` is set. `AVAKIT_WRITE_ALLOWLIST=*` turns the check off.

Any other contract is refused before the chain or the faucet is asked anything:

> Refusing to call 0x52908400098527886E0F7030069857D2E4169EE7 on Avalanche Fuji: write_contract calls only the contracts this server deployed in this session and the ones AVAKIT_WRITE_ALLOWLIST lists in the server environment, which only the person running the server can change. Nothing was signed or sent.

A list with an entry that is not an address stops every `write_contract` call until it is fixed, rather than be read as something it does not say. The refusal names the entry by its place in the list.

The server does not take contracts from a file, not even from a record of deployments in the project: an injected agent can write files too, and an address it wrote into one would be as good as allowed. The deployments this server signed and the environment it was started with are the two things a tool call cannot add to.

### How much AVAX one call sends

`deploy_contract` and `write_contract` send at most `AVAKIT_MAX_VALUE` AVAX with one transaction, and `0.1` while it is not set. It is a decimal number of AVAX with up to 18 decimals; `0` allows no value at all. Gas is paid on top, as always.

Only a call with your own key on Fuji can carry value at all: the session test wallet never sends any, a mainnet call carries none, and a deployment sends none. The templates' `mint` functions are free, so the zero-setup flow sends nothing. A call over the limit is refused the same way:

> Refusing to send 0.5 AVAX with this call: one deploy_contract or write_contract call sends at most 0.1 AVAX, the default while AVAKIT_MAX_VALUE is not set in the server environment, and only the person running the server can change it. Nothing was signed or sent.

A value that is not such a number stops both signing tools until it is fixed, and is not quoted back.

```json
{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": {
        "AVAKIT_WRITE_ALLOWLIST": "0x52908400098527886E0F7030069857D2E4169EE7,0xde709f2102306220921060314715629080e2fb77",
        "AVAKIT_MAX_VALUE": "0.5"
      }
    }
  }
}
```

### What they do not do

Both limits are checked by the tools before anything is asked of the chain, and again by the signer when the transaction is signed, so a path that skipped the first check still gets no signature. They are a floor and not a policy: there is no daily limit, no list of the functions that may be called, no limit on gas, and no confirmation by a person. A contract the server deployed may be called with any of its functions, and may call other contracts in turn, but as itself, so the tokens and approvals your wallet has at a contract that is not on the list stay out of its reach as long as that contract checks `msg.sender`. The AVAX limit holds per call, not in total: a contract deployed in this session can pass on what each call sends it, so repeated calls can move more. A contract that trusts `tx.origin` sees your wallet behind any call made through a contract this server deployed.

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

With your own key the tools refuse up front when it cannot pay for the transaction, and the faucet is never asked. To call a contract you deployed some other way, or in an earlier run of the server, list it in `AVAKIT_WRITE_ALLOWLIST`: see [Write limits](#write-limits).

## Mainnet

Everything goes to Fuji unless a call asks for `chain: "c-chain"`. A mainnet deploy or contract call needs **three** things, and is refused unless all are present:

1. your own key in `AVAKIT_DEPLOYER_KEY` — the session test wallet is never used on mainnet;
2. `confirm: true` in the tool call; and
3. `AVAKIT_ALLOW_MAINNET=1` in the environment the server runs in.

`confirm: true` alone is not enough, on purpose. An agent can be talked into passing it by a
prompt-injected instruction, but it cannot change the environment of the server process — so a
malicious prompt on its own can never spend real funds. That holds while the agent cannot edit the
server's configuration either: keep `AVAKIT_DEPLOYER_KEY` and `AVAKIT_ALLOW_MAINNET` in your
user-level MCP client config, not in a project file such as `.mcp.json` or `.cursor/mcp.json`. The
refusal names the variable, so you will see what is missing. `write_contract` never sends AVAX
with a call on mainnet, and is held to the [write limits](#write-limits) there as on Fuji: it calls
a contract the server deployed on the C-Chain in this session, or one `AVAKIT_WRITE_ALLOWLIST`
lists.

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
| `AVAKIT_WRITE_ALLOWLIST` | From 0.3.0: comma-separated addresses `write_contract` may call besides the contracts the server deployed in this session; `*` allows any. Unset, only this session's deployments. See [Write limits](#write-limits). |
| `AVAKIT_MAX_VALUE` | From 0.3.0: the most AVAX one `deploy_contract` or `write_contract` call may send, as a decimal number. Unset, `0.1`; `0` allows none. |
| `AVAKIT_MCP_ROOT` | The directory `scaffold_app` creates projects in and `artifactPath` reads from, instead of the server's working directory. Needed when the server is started in the filesystem root. |

## License

MIT © AvaKit contributors

The published `dist/index.js` contains third-party code: `@modelcontextprotocol/sdk`, `viem`, `zod` and the packages they depend on, all under permissive licences (MIT, ISC, BSD-3-Clause). `dist/THIRD_PARTY_LICENSES.txt`, shipped in the package, names every bundled package with its version, licence and licence text. The build writes it from the list of files that went into the bundle, and fails if a bundled package has no licence or one that is not on its allow-list of permissive licences.
