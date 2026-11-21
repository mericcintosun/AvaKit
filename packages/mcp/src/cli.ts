/**
 * The two things `avakit-mcp` does besides serving: print its version, and
 * print what it is. Both answer on stdout and are done before the stdio server
 * exists, so they are safe to run by hand — and `npx -y @avakit/mcp --version`
 * is how to download the server ahead of a client that only waits so long for
 * it to connect.
 */

/** What a command line asks for. */
export type Invocation = "version" | "help" | "serve";

/**
 * Read the arguments after the script name. The first `--version`/`-v` or
 * `--help`/`-h` decides; anything else is not ours to judge and starts the
 * server, as every argument did before these two existed.
 */
export function invocation(args: readonly string[]): Invocation {
  for (const arg of args) {
    if (arg === "--version" || arg === "-v") return "version";
    if (arg === "--help" || arg === "-h") return "help";
  }
  return "serve";
}

/** The server's tools, one line each. `cli.test.ts` holds this to what the server registers. */
export const TOOL_SUMMARIES: readonly (readonly [name: string, summary: string])[] = [
  ["scaffold_app", "Create an Avalanche dapp from a template"],
  ["list_templates", "List the templates and the chains each one supports"],
  ["read_chain", "Read a balance, a transaction receipt or a contract view function"],
  ["estimate_gas", "Estimate the gas and rough cost of a call"],
  ["deploy_contract", "Deploy a compiled contract (Fuji by default; mainnet is gated)"],
  ["write_contract", "Send a state-changing contract call, for example mint"],
  ["wallet_status", "Show which wallet would sign on a chain, and its balance"],
  ["get_context", "Return AvaKit and Avalanche coding context and doc links"],
];

/** The variables the server reads from its environment, one line each. */
export const ENVIRONMENT_SUMMARIES: readonly (readonly [name: string, summary: string])[] = [
  [
    "AVAKIT_DEPLOYER_KEY",
    "Your own key for deploy_contract and write_contract. Unset: a session test wallet, Fuji only",
  ],
  ["AVAKIT_TEST_WALLET", "Set to 0 to turn the session test wallet off"],
  ["AVAKIT_FAUCET_URL", "Another AvaKit faucet for the session test wallet to ask"],
  [
    "AVAKIT_ALLOW_MAINNET",
    "Set to 1 to allow mainnet transactions (they also need your own key and confirm: true)",
  ],
  [
    "AVAKIT_WRITE_ALLOWLIST",
    "Contracts write_contract may call besides this session's deploys (comma-separated; * for any)",
  ],
  [
    "AVAKIT_MAX_VALUE",
    "Most AVAX one deploy_contract or write_contract call may send (default 0.1)",
  ],
  [
    "AVAKIT_MCP_ROOT",
    "Where scaffold_app creates projects and artifactPath is read, instead of the working directory",
  ],
];

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, summary]) => `  ${name.padEnd(width)}  ${summary}`);
}

/** The text `--help` prints. */
export function helpText(version: string): string {
  return `${[
    `avakit-mcp ${version}: the AvaKit MCP server for Avalanche`,
    "",
    "A Model Context Protocol server that lets an AI coding agent scaffold an Avalanche",
    "dapp, deploy and call contracts, and read the chain. It talks JSON-RPC on standard",
    "input and output, so it is started by an MCP client rather than used by hand.",
    "",
    "Usage",
    "  avakit-mcp             Start the server on stdio (what a client runs)",
    "  avakit-mcp --version   Print the version and exit (-v)",
    "  avakit-mcp --help      Print this text and exit (-h)",
    "",
    "Add it to a client",
    "  Claude Code:",
    "    claude mcp add avakit -- npx -y @avakit/mcp",
    "  Cursor, Claude Desktop and other clients with a JSON config:",
    '    { "mcpServers": { "avakit": { "command": "npx", "args": ["-y", "@avakit/mcp"] } } }',
    "",
    "Tools",
    ...table(TOOL_SUMMARIES),
    "",
    "Environment variables (all optional, read from the server's own environment)",
    ...table(ENVIRONMENT_SUMMARIES),
    "",
    "Documentation: https://www.npmjs.com/package/@avakit/mcp",
  ].join("\n")}\n`;
}
