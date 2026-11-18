/**
 * The port from `--port <n>`, `-p <n>` or `--port=<n>`; undefined when the flag
 * is absent (or 0), which means "any free port". A value that is not a port
 * throws: quietly falling back to a random port would hide the typo.
 */
export function parsePort(argv: string[]): number | undefined {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--port" || arg === "-p") {
      raw = argv[i + 1] ?? "";
      break;
    }
    if (arg.startsWith("--port=")) {
      raw = arg.slice("--port=".length);
      break;
    }
  }
  if (raw === undefined) return undefined;
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isNaN(n) || n > 65535) {
    throw new Error(`--port expects a port number between 1 and 65535, got "${raw}"`);
  }
  return n === 0 ? undefined : n;
}
