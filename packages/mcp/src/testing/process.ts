/**
 * Test helper: run the server as a real process and talk to it the way an MCP
 * client does — one hand-written JSON-RPC message per line on its stdin, one
 * answer per line on its stdout. No client library on this side, so what is
 * tested is what the process really writes.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export interface Answer {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

export interface ServerProcess {
  /** Send a request and wait for its answer. */
  request(method: string, params?: Record<string, unknown>): Promise<Answer>;
  /** Send a notification, which has no answer. */
  notify(method: string): void;
  /** Call a tool and return the text it answered with. */
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ isError: boolean; text: string }>;
  /** Every line written to stdout so far, protocol frame or not. */
  readonly lines: string[];
  /** Everything written to stderr so far. */
  stderr(): string;
  /** Close stdin, as a client does when it is done, and wait for the exit code. */
  close(): Promise<number | null>;
}

/**
 * The caller's environment without anything that configures the server, and
 * without NODE_PATH: pnpm sets it to this repo's store for the scripts it
 * runs, which would let a `require` in the child find packages that a user's
 * install does not have.
 */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("AVAKIT_") || name === "NODE_PATH") delete env[name];
  }
  return { ...env, ...extra };
}

export function startServer(
  entry: string,
  options: { cwd: string; args?: string[]; nodeArgs?: string[]; env?: Record<string, string> },
): ServerProcess {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [...(options.nodeArgs ?? []), entry, ...(options.args ?? [])],
    { cwd: options.cwd, env: cleanEnv(options.env), stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines: string[] = [];
  const waiting = new Map<number, (answer: Answer) => void>();
  let stderr = "";
  let buffered = "";
  let nextId = 1;
  let failure: Error | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.on("error", (error) => {
      failure = error;
      resolve(null);
    });
    child.on("close", (code) => resolve(code));
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end === -1) break;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      lines.push(line);
      try {
        const answer = JSON.parse(line) as Answer;
        if (typeof answer.id === "number") waiting.get(answer.id)?.(answer);
      } catch {
        // Not a frame. Tests assert on `lines`, which has it.
      }
    }
  });

  const request = (method: string, params?: Record<string, unknown>): Promise<Answer> => {
    const id = nextId++;
    const answered = new Promise<Answer>((resolve) => waiting.set(id, resolve));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`,
    );
    // A server that died instead of answering must fail the test, not hang it.
    return Promise.race([
      answered,
      exited.then((code) => {
        throw new Error(
          `the server exited (${failure?.message ?? `code ${code}`}) before answering ${method}:\n${stderr}`,
        );
      }),
    ]);
  };

  return {
    request,
    notify: (method) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
    callTool: async (name, args = {}) => {
      const answer = await request("tools/call", { name, arguments: args });
      const parts = (answer.result?.content ?? []) as { text?: string }[];
      return {
        isError: answer.result?.isError === true,
        text: parts.map((part) => part.text ?? "").join("\n"),
      };
    },
    lines,
    stderr: () => stderr,
    close: () => {
      child.stdin.end();
      return exited;
    },
  };
}
