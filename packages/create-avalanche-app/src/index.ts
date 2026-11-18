import { checkNodeVersion } from "./preflight.js";

// The bin entry. First of all, is this a Node.js the CLI can run on? The check
// comes before the CLI is even loaded (that import is the dynamic one below),
// so a Node.js too old for the CLI's own code or its dependencies still gets
// the line that says so, not a stack trace from somewhere inside them.
const node = checkNodeVersion(process.versions.node);
if (node.message) process.stderr.write(`${node.message}\n`);

if (!node.ok) {
  // Setting the code rather than calling process.exit(), which can end the
  // process before the line above has left a pipe.
  process.exitCode = 1;
} else {
  // Hand the real process to `run()` and exit with what it returns. Everything
  // else lives in cli.ts, where it can be tested without a process of its own.
  const { run } = await import("./cli.js");
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
}
