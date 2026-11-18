/**
 * A one-line diagnostic for whoever reads the server's log. It goes to STDERR:
 * stdout is the JSON-RPC channel, and a stray line there breaks the client.
 * Callers pass addresses and outcomes only — never a key.
 */
export function log(line: string): void {
  process.stderr.write(`avakit-mcp: ${line}\n`);
}
