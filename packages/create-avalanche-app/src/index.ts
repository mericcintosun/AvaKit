import { run } from "./cli.js";

// The bin entry: hand the real process to `run()` and exit with what it returns.
// Everything else lives in cli.ts, where it can be tested.
run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  stdinIsTTY: Boolean(process.stdin.isTTY),
  platform: process.platform,
}).then((code) => {
  // A clean run just lets the event loop drain; a failure exits right away.
  if (code !== 0) process.exit(code);
});
