/**
 * @avakit/mcp — the AvaKit MCP server and its tools.
 *
 * Exposes Avalanche *actions* (not just docs) to AI coding agents:
 *   • scaffold_app     — create a dapp from a template (wraps create-avalanche-app)
 *   • list_templates   — available templates
 *   • read_chain       — balance / tx receipt / contract view
 *   • estimate_gas     — gas and rough cost of a call
 *   • deploy_contract  — deploy a compiled contract (testnet-first; mainnet is double-gated)
 *   • write_contract   — send a state-changing contract call, e.g. mint
 *   • wallet_status    — which wallet would sign, and its balance
 *   • get_context      — AvaKit + Avalanche coding context
 *
 * See docs/09-spec-mcp.md. Guardrails, each documented in README.md:
 *
 *   • On Fuji the signing tools need no key: they use a session test wallet that
 *     exists only in this process's memory, signs for Fuji only and never sends
 *     value (wallet.ts). A key of the user's own comes only from the
 *     AVAKIT_DEPLOYER_KEY env var. Neither is ever logged or returned.
 *   • A mainnet transaction needs the user's own key, the caller's
 *     `confirm: true` and the operator's AVAKIT_ALLOW_MAINNET=1 in the server
 *     environment.
 *   • scaffold_app only writes, and artifactPath only reads, inside the server's
 *     working directory (or AVAKIT_MCP_ROOT).
 *
 * The environment gates are the ones a prompt-injected tool call cannot open.
 *
 * This module only builds the server; `index.ts` is the entry that puts it on
 * stdio. Keeping the two apart is what lets the tools be tested in-process.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import {
  type AvaChain,
  cChain,
  fuji,
  getBalance,
  getPublicClient,
  getTransactionReceipt,
  isMainnet,
  readContract,
} from "@avakit/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listTemplates, scaffoldApp } from "create-avalanche-app/api";
import { type Abi, type Address, formatEther, type Hex, isAddress } from "viem";
import { z } from "zod";
import { normalizeAbi, selectReadFunction } from "./abi.js";
import { deployableBytecode, deployHint, findArtifacts, readArtifact } from "./artifact.js";
import { deployContract } from "./deploy.js";
import { reasonOf, ToolError } from "./errors.js";
import {
  ADDRESS_RE,
  assertMainnetAllowed,
  BYTECODE_RE,
  MAX_ABI_ITEMS,
  MAX_ARGS,
  MAX_BYTECODE_LEN,
  mainnetOpenedByOperator,
  resolveScaffoldTarget,
  resolveWorkspace,
} from "./guards.js";
import { VERSION } from "./version.js";
import { resolveSigner, walletFor } from "./wallet.js";
import { writeContract } from "./write.js";

type ChainSlug = "fuji" | "c-chain";

function chainFrom(id: string | undefined): AvaChain {
  return id === "c-chain" ? cChain : fuji;
}

function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val), 2);
}

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

/**
 * What a failed signing tool returns. A `ToolError` and a refused gate were
 * written to be read as they are; anything else is an accident, and gets the
 * tool's name in front and one line of the library's reason — never its dump.
 */
function failed(tool: string, error: unknown) {
  if (error instanceof ToolError) return text(error.message, true);
  return text(`${tool} failed: ${reasonOf(error)}`, true);
}

/** Longest path accepted as `artifactPath`. */
const MAX_PATH_LENGTH = 4096;

const chainInput = z.enum(["fuji", "c-chain"]).default("fuji");

const confirmInput = z
  .boolean()
  .optional()
  .describe(
    "Required on mainnet (c-chain), together with AVAKIT_ALLOW_MAINNET=1 in the server environment. Not needed on Fuji.",
  );

const artifactPathInput = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .optional()
  .describe(
    "Path to the contract's artifact file, relative to the server's working directory: one of the `artifacts` scaffold_app returned (e.g. my-app/lib/nft-artifact.ts), or a Foundry/Hardhat JSON artifact with abi and bytecode. Must be inside the working directory.",
  );

/**
 * Hints for clients that ask a person before a tool runs. The signing tools
 * change state outside this machine (a chain), and never undo anything.
 */
const READ_ONLY = { readOnlyHint: true } as const;
const SENDS_TRANSACTION = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const SIGNING =
  "On the Fuji testnet (the default) no key is needed: when AVAKIT_DEPLOYER_KEY is not set, the " +
  "server signs with a temporary session test wallet that exists only in its memory, works on Fuji " +
  "only, and is funded from the AvaKit faucet when it cannot pay. Mainnet (c-chain) needs all three " +
  "of: your own key in AVAKIT_DEPLOYER_KEY, confirm:true in this call AND AVAKIT_ALLOW_MAINNET=1 in " +
  "the server's environment, which only the person running the server can set — without it a " +
  "mainnet call is refused even with confirm:true.";

/**
 * The server with every tool registered, not yet connected to anything.
 * `index.ts` connects it to stdio; tests connect it to an in-memory transport
 * and call the tools exactly as a client would.
 */
export const server = new McpServer({ name: "avakit-mcp", version: VERSION });

server.registerTool(
  "list_templates",
  {
    title: "List templates",
    description: "List the Avalanche dapp templates available to scaffold_app.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY,
  },
  async () => text(toJson(listTemplates())),
);

server.registerTool(
  "scaffold_app",
  {
    title: "Scaffold an Avalanche dapp",
    description:
      "Create a new Avalanche dapp from a template (minimal, nft-mint, token-gated-app, erc20-token, icm-messenger, eerc-token, l1-launch, token-bridge). Wraps create-avalanche-app. Returns the created files, next steps, and `artifacts`: the paths of the project's compiled contracts, which deploy_contract and write_contract take as artifactPath — nothing has to be read or copied to deploy and call them. Each template supports only the chains list_templates shows for it — most are Fuji-only — and any other chain is refused. The project is created inside the server's working directory (or AVAKIT_MCP_ROOT, when the server was started with it); a directory outside it is refused.",
    inputSchema: z
      .object({
        name: z.string().describe("Project directory name, e.g. my-avax-app"),
        template: z
          .enum([
            "minimal",
            "nft-mint",
            "token-gated-app",
            "erc20-token",
            "icm-messenger",
            "eerc-token",
            "l1-launch",
            "token-bridge",
          ])
          .default("minimal"),
        chain: z
          .enum(["fuji", "c-chain"])
          .default("fuji")
          .describe(
            "Must be one of the template's chains (see list_templates). c-chain is mainnet.",
          ),
        directory: z
          .string()
          .optional()
          .describe(
            "Parent directory for the project. Must be inside the server's working directory, which is also the default.",
          ),
        local: z
          .boolean()
          .optional()
          .describe(
            "Only for developing AvaKit itself: links @avakit/* with workspace:*, so the app installs only inside the AvaKit monorepo. Leave unset.",
          ),
      })
      .strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ name, template, chain, directory, local }) => {
    // Validate before touching the filesystem — an AI agent may pass whatever a
    // prompt told it to. `name` must be a single safe path segment and the
    // target must stay inside the directory this server creates projects in.
    let targetDir: string;
    try {
      targetDir = resolveScaffoldTarget(name, directory);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
    if (existsSync(targetDir)) {
      if (!statSync(targetDir).isDirectory()) {
        return text(`"${targetDir}" already exists and is not a directory.`, true);
      }
      if (readdirSync(targetDir).length > 0) {
        return text(`Directory "${targetDir}" already exists and is not empty.`, true);
      }
    }
    let files: string[];
    try {
      ({ files } = await scaffoldApp({
        projectName: name,
        targetDir,
        template,
        chain,
        local,
      }));
    } catch (e) {
      // Above all a chain the template does not list: scaffoldApp refuses it,
      // before writing anything, with a message that names the supported ones.
      return text(e instanceof Error ? e.message : String(e), true);
    }
    const setup = listTemplates().find((t) => t.id === template)?.setup;
    // The contracts the project can deploy, as paths the signing tools accept:
    // an agent goes from here to a deployed contract without opening a file.
    const artifacts = findArtifacts(targetDir, files, resolveWorkspace().root);
    const [first] = artifacts;
    // npm, because it is the one package manager every machine that can run
    // this server has: a client starts the server with npx, which is npm's.
    // The apps install with pnpm, yarn and bun as well. An app linked with
    // `local` resolves workspace:* ranges, which only pnpm inside the AvaKit
    // monorepo can install.
    const [install, run] = local ? ["pnpm install", "pnpm run"] : ["npm install", "npm run"];
    const nextSteps = [
      `cd ${name}`,
      install,
      // Every scaffold ships burner + injected + social login. Social login
      // works out of the box on localhost via a bundled demo key; only your own
      // deployment needs a client id (cp .env.example .env.local).
      ...(setup ? [`${run} ${setup}  # start the local Avalanche network (run once)`] : []),
      `${run} dev`,
      ...(first
        ? [
            setup
              ? // Its app talks to a network on this machine, which the signing
                // tools cannot reach: they know Fuji and the C-Chain.
                `This template's app deploys its contract from the browser, to the local network that \`${run} ${setup}\` starts. deploy_contract and write_contract reach Fuji and the C-Chain only.`
              : deployHint(first),
          ]
        : []),
    ];
    return text(
      toJson({
        path: targetDir,
        filesCreated: files.length,
        files,
        artifacts: artifacts.map((artifact) => artifact.path),
        nextSteps,
      }),
    );
  },
);

server.registerTool(
  "read_chain",
  {
    title: "Read Avalanche chain data",
    description:
      "Read a native AVAX balance, a transaction receipt, or a contract view/pure function over RPC. No key needed. For contractRead pass the contract's ABI the same way write_contract takes it: as artifactPath (one of the `artifacts` scaffold_app returned) or as abi (the JSON ABI, or just the function's signature). To change state (for example to mint) use write_contract.",
    inputSchema: z
      .object({
        action: z.enum(["balance", "txReceipt", "contractRead"]),
        chain: z.enum(["fuji", "c-chain"]).default("fuji"),
        address: z.string().optional().describe("Address for balance / contractRead"),
        hash: z.string().optional().describe("Tx hash for txReceipt"),
        abi: z
          .array(z.any())
          .max(MAX_ABI_ITEMS)
          .optional()
          .describe(
            'For contractRead, instead of artifactPath: the JSON ABI, or signatures such as ["function ownerOf(uint256 tokenId) view returns (address)"].',
          ),
        artifactPath: artifactPathInput,
        functionName: z
          .string()
          .max(500)
          .optional()
          .describe(
            'For contractRead: the view or pure function to read, e.g. "ownerOf". To pick between overloads, the full signature, e.g. "balanceOf(address,uint256)".',
          ),
        args: z
          .array(z.any())
          .max(MAX_ARGS)
          .optional()
          .describe("The function's arguments, in order. Pass large integers as decimal strings."),
      })
      .strict(),
    annotations: READ_ONLY,
  },
  async ({ action, chain, address, hash, abi, artifactPath, functionName, args }) => {
    const c = chainFrom(chain);
    try {
      if (action === "balance") {
        if (!address) return text("balance requires 'address'.", true);
        const wei = await getBalance(address as Address, c);
        return text(toJson({ address, chain: c.name, wei, avax: (Number(wei) / 1e18).toString() }));
      }
      if (action === "txReceipt") {
        if (!hash) return text("txReceipt requires 'hash'.", true);
        return text(toJson(await getTransactionReceipt(hash as Hex, c)));
      }
      if (!address || !functionName) {
        return text(
          "contractRead requires 'address', 'functionName' and the contract's ABI (artifactPath or abi).",
          true,
        );
      }
      if (!ADDRESS_RE.test(address)) {
        return text(
          "contractRead: 'address' must be a 0x-prefixed, 40-hex-character address.",
          true,
        );
      }
      // The same ABI forms and the same function selection as write_contract,
      // so what scaffold_app returned can be read as well as called.
      const { item, args: callArgs } = selectReadFunction(
        abiFrom("read_chain", { abi, artifactPath }),
        functionName,
        args,
      );
      const result = await readContract(c, {
        address: address as Address,
        abi: [item],
        functionName: item.name as never,
        args: callArgs,
      });
      return text(toJson(result));
    } catch (e) {
      return failed("read_chain", e);
    }
  },
);

server.registerTool(
  "estimate_gas",
  {
    title: "Estimate gas",
    description:
      "Estimate the gas a transaction (to / data / value) would use and report the current gas price and rough AVAX cost, over RPC. No key needed.",
    inputSchema: z
      .object({
        chain: z.enum(["fuji", "c-chain"]).default("fuji"),
        to: z.string().describe("Recipient / contract address (0x…)"),
        from: z.string().optional().describe("Sender address (0x…)"),
        data: z.string().optional().describe("Calldata (0x…)"),
        value: z.string().optional().describe("Native value in wei (decimal string)"),
      })
      .strict(),
    annotations: READ_ONLY,
  },
  async ({ chain, to, from, data, value }) => {
    const c = chainFrom(chain);
    try {
      const client = getPublicClient(c);
      const [gas, gasPrice] = await Promise.all([
        client.estimateGas({
          account: (from as Address | undefined) ?? undefined,
          to: to as Address,
          data: data as Hex | undefined,
          value: value ? BigInt(value) : undefined,
        }),
        client.getGasPrice(),
      ]);
      const costWei = gas * gasPrice;
      return text(
        toJson({
          chain: c.name,
          gas,
          gasPrice,
          estimatedCostWei: costWei,
          estimatedCostAvax: (Number(costWei) / 1e18).toString(),
        }),
      );
    } catch (e) {
      return text(`estimate_gas failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  },
);

/** An ABI from a tool call: inline, or out of the artifact file a path names. Exactly one. */
function abiFrom(
  tool: string,
  { abi, artifactPath }: { abi?: unknown[]; artifactPath?: string },
): Abi {
  if (abi && artifactPath) {
    throw new ToolError(`${tool} takes the ABI as artifactPath or as abi, not both.`);
  }
  if (artifactPath) return readArtifact(artifactPath).abi;
  if (abi) return normalizeAbi(abi);
  throw new ToolError(
    `${tool} needs the contract's ABI: pass artifactPath (the artifact file, e.g. one of the ` +
      "`artifacts` scaffold_app returned) or abi (the JSON ABI, or just the signature of the " +
      'function, e.g. ["function mint() returns (uint256)"]).',
  );
}

server.registerTool(
  "deploy_contract",
  {
    title: "Deploy a contract",
    description:
      "Deploy a compiled contract to Avalanche and return its address, once the transaction has succeeded and there is code at that address. Pass the contract either as artifactPath (a file: one of the `artifacts` scaffold_app returned, or a Foundry/Hardhat JSON artifact) or as abi + bytecode — exactly one of the two; artifactPath means no bytecode has to be copied into the call. " +
      `${SIGNING} ` +
      "A deployment that reverts is returned as an error. The result says which wallet signed. To call the deployed contract — for example to mint — use write_contract.",
    inputSchema: z
      .object({
        artifactPath: artifactPathInput,
        abi: z
          .array(z.any())
          .max(MAX_ABI_ITEMS)
          .optional()
          .describe(
            'With bytecode, instead of artifactPath: the JSON ABI, or signatures such as ["constructor(address owner)"].',
          ),
        bytecode: z
          .string()
          .regex(BYTECODE_RE, "bytecode must be 0x-prefixed hex")
          .max(MAX_BYTECODE_LEN)
          .optional()
          .describe("With abi, instead of artifactPath: the creation bytecode (0x-prefixed)."),
        args: z
          .array(z.any())
          .max(MAX_ARGS)
          .optional()
          .describe("Constructor arguments, in order. Pass large integers as decimal strings."),
        chain: chainInput,
        confirm: confirmInput,
      })
      .strict(),
    annotations: SENDS_TRANSACTION,
  },
  async ({ artifactPath, abi, bytecode, args, chain, confirm }) => {
    const c = chainFrom(chain);
    try {
      assertMainnetAllowed(c, confirm);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
    try {
      let contract: { abi: Abi; bytecode: Hex };
      if (artifactPath) {
        if (abi || bytecode) {
          throw new ToolError(
            "deploy_contract takes the contract as artifactPath, or as abi and bytecode — not both.",
          );
        }
        const artifact = readArtifact(artifactPath);
        contract = { abi: artifact.abi, bytecode: deployableBytecode(artifact, artifactPath) };
      } else if (abi && bytecode) {
        contract = {
          abi: normalizeAbi(abi),
          bytecode: (bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`) as Hex,
        };
      } else {
        throw new ToolError(
          "deploy_contract needs the contract: pass artifactPath (the artifact file, e.g. one of the " +
            "`artifacts` scaffold_app returned), or both abi and bytecode.",
        );
      }
      return text(toJson(await deployContract(c, resolveSigner(c), { ...contract, args })));
    } catch (e) {
      // "deploy failed", as this tool has always said for the unexpected.
      return failed("deploy", e);
    }
  },
);

server.registerTool(
  "write_contract",
  {
    title: "Call a contract (state-changing)",
    description:
      'Send a state-changing contract call — for example mint — and return once it has succeeded on chain. The call is simulated first: if it would revert, the revert reason is returned and nothing is sent. Give the ABI as artifactPath (the file deploy_contract took) or as abi, which can be just the function\'s signature, e.g. ["function mint() returns (uint256)"] — exactly one of the two. ' +
      `${SIGNING} ` +
      "The result says which wallet signed. To read state use read_chain.",
    inputSchema: z
      .object({
        address: z
          .string()
          .regex(ADDRESS_RE, "address must be 0x followed by 40 hex characters")
          .refine((value) => !ADDRESS_RE.test(value) || isAddress(value), {
            message:
              "address must be all lowercase or carry a valid EIP-55 checksum; this capitalisation is neither, so a character may be mistyped",
          })
          .describe("The contract's address, e.g. the one deploy_contract returned."),
        functionName: z
          .string()
          .min(1)
          .max(500)
          .describe(
            'The function to call, e.g. "mint". To pick between overloads, the full signature, e.g. "safeTransferFrom(address,address,uint256)".',
          ),
        abi: z
          .array(z.any())
          .max(MAX_ABI_ITEMS)
          .optional()
          .describe(
            'Instead of artifactPath: the JSON ABI, or signatures such as ["function mint() returns (uint256)"].',
          ),
        artifactPath: artifactPathInput,
        args: z
          .array(z.any())
          .max(MAX_ARGS)
          .optional()
          .describe("The function's arguments, in order. Pass large integers as decimal strings."),
        value: z
          .string()
          .regex(/^\d{1,78}$/, "value must be a whole number of wei, as a decimal string")
          .optional()
          .describe(
            "Wei to send with a payable call (decimal string). Only with your own key (AVAKIT_DEPLOYER_KEY) on Fuji: the session test wallet never sends value, and value is refused on mainnet.",
          ),
        chain: chainInput,
        confirm: confirmInput,
      })
      .strict(),
    annotations: SENDS_TRANSACTION,
  },
  async ({ address, functionName, abi, artifactPath, args, value, chain, confirm }) => {
    const c = chainFrom(chain);
    try {
      assertMainnetAllowed(c, confirm, "send");
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
    try {
      const result = await writeContract(c, resolveSigner(c), {
        address: address as Address,
        abi: abiFrom("write_contract", { abi, artifactPath }),
        functionName,
        args,
        value: value ? BigInt(value) : undefined,
      });
      return text(toJson(result));
    } catch (e) {
      return failed("write_contract", e);
    }
  },
);

server.registerTool(
  "wallet_status",
  {
    title: "Wallet status",
    description:
      'Show the wallet deploy_contract and write_contract would sign with on a chain, where it comes from ("session": the temporary Fuji test wallet; "env": your key in AVAKIT_DEPLOYER_KEY; "none": nothing to sign with), and its balance. Read-only: it sends nothing and never asks the faucet for funds. A session wallet with a zero balance is normal before its first transaction — the signing tools fund it when it cannot pay. On mainnet (c-chain) there is a wallet only when AVAKIT_DEPLOYER_KEY is set.',
    inputSchema: z.object({ chain: chainInput }).strict(),
    annotations: READ_ONLY,
  },
  async ({ chain }) => {
    const c = chainFrom(chain);
    const slug: ChainSlug = chain;
    // A wallet is one of three things a mainnet call needs. Say where the others stand.
    const gates = isMainnet(c)
      ? `A call on ${c.name} also needs confirm:true and AVAKIT_ALLOW_MAINNET=1 in the server ` +
        `environment, which is ${mainnetOpenedByOperator() ? "set" : "not set"}.`
      : "";
    try {
      const wallet = walletFor(c);
      if (wallet.source === "none") {
        return text(
          toJson({
            address: null,
            source: "none",
            chain: slug,
            balanceWei: null,
            balanceAvax: null,
            note: gates ? `${wallet.why} ${gates}` : wallet.why,
          }),
        );
      }
      let wei: bigint;
      try {
        wei = await getBalance(wallet.address, c);
      } catch (e) {
        return text(
          `The wallet on ${c.name} is ${wallet.address} (source: ${wallet.source}), but its balance could not be read: ${reasonOf(e)}`,
          true,
        );
      }
      const note =
        wallet.source === "session"
          ? "A temporary Fuji test wallet that lives only until the server stops. A zero balance is normal before its first transaction: deploy_contract and write_contract ask the AvaKit faucet for test AVAX when it cannot pay."
          : gates;
      return text(
        toJson({
          address: wallet.address,
          source: wallet.source,
          chain: slug,
          balanceWei: wei,
          balanceAvax: formatEther(wei),
          ...(note ? { note } : {}),
        }),
      );
    } catch (e) {
      return failed("wallet_status", e);
    }
  },
);

/**
 * Fuji's own faucet page, from the chain's definition in @avakit/core (Builder
 * Hub, which asks for a sign-in), as the two lines of the context that name it.
 * Nothing is said about a page the definition does not have.
 */
const FUJI_FAUCET_FALLBACK = fuji.faucetUrl
  ? `your own funded Fuji key in \`AVAKIT_DEPLOYER_KEY\`, or test AVAX for the session wallet's address from ${fuji.faucetUrl} (that page needs a free Builder Hub sign-in)`
  : "your own funded Fuji key in `AVAKIT_DEPLOYER_KEY`, or test AVAX sent to the session wallet's address";
const FUJI_FAUCET_LINK = fuji.faucetUrl
  ? `\n- Fuji faucet: ${fuji.faucetUrl} (needs a free Builder Hub sign-in; the session test wallet above needs none: the server funds it from the AvaKit faucet)`
  : "";

const AVAKIT_CONTEXT = `# AvaKit context

AvaKit is an open-source, AI-native Avalanche developer toolkit.

## Scaffolding
- \`scaffold_app\` (this MCP) or \`npm create avalanche-app@latest\`
- Templates: minimal, nft-mint, token-gated-app, erc20-token, icm-messenger, eerc-token, l1-launch, token-bridge
- Each app ships shadcn/ui (black & white + dark/light), a wallet chooser (zero-setup burner + social login + injected), and CLAUDE.md/llms.txt/.cursor rules.

## Deploying and calling contracts from this MCP server
- Fuji testnet (the default): no key is needed. Without \`AVAKIT_DEPLOYER_KEY\`, \`deploy_contract\` and \`write_contract\` sign with a temporary session test wallet — created in the server's memory, Fuji only, gone when the server stops — and fund it from the AvaKit faucet when it cannot pay. \`wallet_status\` shows it.
- Three calls, no file to read or copy: \`scaffold_app\` (its result lists \`artifacts\`) → \`deploy_contract({ artifactPath })\` → \`write_contract({ address, artifactPath, functionName: "mint" })\`.
- Minting, like every other state-changing call, is done with \`write_contract\`. Reading is \`read_chain\`.
- Mainnet (\`chain: "c-chain"\`) needs all three: your own key in \`AVAKIT_DEPLOYER_KEY\`, \`confirm: true\` in the call, and \`AVAKIT_ALLOW_MAINNET=1\` in the server's environment. The session test wallet is never used on mainnet.
- If the AvaKit faucet refuses (rate limit, empty), there are two ways forward: ${FUJI_FAUCET_FALLBACK}.

## @avakit/react
- \`<AvaKitProvider chains={[...]} adapters={[...]}>\`, \`<ConnectAvalanche />\`
- Hooks: useAvaAccount, useAvaChain, useBalance, useContract, useAvaDeploy, useAvaKit

## @avakit/core
- Chains: fuji, cChain, defineChain (from @avakit/core/chains)
- Adapters: injectedAdapter(), web3authAdapter({ clientId }) (from @avakit/core/web3auth)
- getPublicClient, getWalletClient, ensureChain, deployContract, getBalance, readContract

## Conventions
- UI: shadcn/ui only. Black & white until brand colors are added; dark/light from day one.
- Chains: Fuji testnet by default; mainnet is explicit opt-in.
- Secrets: never in code. Web3Auth client ID (free) in NEXT_PUBLIC_WEB3AUTH_CLIENT_ID.

## Docs
- Avalanche Builder Hub: https://build.avax.network/llms.txt
- Web3Auth dashboard: https://dashboard.web3auth.io${FUJI_FAUCET_LINK}`;

server.registerTool(
  "get_context",
  {
    title: "Get AvaKit context",
    description:
      "Return AvaKit + Avalanche context for coding: the API surface, conventions, doc links, and how deploying and minting work from this server (no key needed on Fuji; what mainnet needs).",
    inputSchema: z
      .object({ topic: z.string().optional().describe("Optional focus topic") })
      .strict(),
    annotations: READ_ONLY,
  },
  async ({ topic }) =>
    text(topic ? `${AVAKIT_CONTEXT}\n\n(Requested focus: ${topic})` : AVAKIT_CONTEXT),
);
