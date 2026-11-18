import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineSplitter, PARTIAL_LINE_MS, type RunHandle, runSteps, type Step } from "./steps.js";
import { createSandbox, type Sandbox } from "./testing/sandbox.js";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(() => {
  sandbox.dispose();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run steps to completion. Waits a little past the first `onDone` so a second
 * one (or a line emitted after it) would be caught.
 */
async function run(
  steps: Step[],
  during?: (handle: RunHandle, lines: string[]) => void,
): Promise<{ lines: string[]; exits: number[]; linesAtDone: number }> {
  const lines: string[] = [];
  const exits: number[] = [];
  let linesAtDone = -1;
  let handle: RunHandle | undefined;
  await new Promise<void>((resolve) => {
    handle = runSteps(
      steps,
      (line) => {
        lines.push(line);
        if (handle) during?.(handle, lines);
      },
      (code) => {
        exits.push(code);
        if (linesAtDone === -1) linesAtDone = lines.length;
        resolve();
      },
    );
  });
  await sleep(150);
  return { lines, exits, linesAtDone };
}

const step = (...args: string[]): Step => ({ cmd: "tool", args });

describe("lineSplitter", () => {
  function collect() {
    const lines: string[] = [];
    return { lines, splitter: lineSplitter((line) => lines.push(line)) };
  }

  it("holds a line that is cut by a chunk boundary until the rest arrives", () => {
    const { lines, splitter } = collect();
    splitter.push(Buffer.from("first\nError: blockchain chain1 has alr"));
    expect(lines).toEqual(["first"]);
    splitter.push(Buffer.from("eady been deployed\nlast"));
    expect(lines).toEqual(["first", "Error: blockchain chain1 has already been deployed"]);
    splitter.end();
    expect(lines.at(-1)).toBe("last");
  });

  it("does not break a multi-byte character that straddles two chunks", () => {
    const { lines, splitter } = collect();
    const bytes = Buffer.from("✔ done\n");
    splitter.push(bytes.subarray(0, 2));
    splitter.push(bytes.subarray(2));
    expect(lines).toEqual(["✔ done"]);
  });

  it("ends a line at \\n, \\r\\n and a bare \\r, trims it, and drops empty ones", () => {
    const { lines, splitter } = collect();
    splitter.push(Buffer.from("  one  \r\ntwo\rthree\n\n\r"));
    // A CRLF split across chunks is still one line end.
    splitter.push(Buffer.from("four\r"));
    splitter.push(Buffer.from("\nfive\n"));
    expect(lines).toEqual(["one", "two", "three", "four", "five"]);
  });

  it("shows an unfinished line after a pause instead of sitting on it", () => {
    vi.useFakeTimers();
    try {
      const { lines, splitter } = collect();
      splitter.push(Buffer.from("Waiting for the node to sync"));
      vi.advanceTimersByTime(PARTIAL_LINE_MS - 1);
      expect(lines).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(lines).toEqual(["Waiting for the node to sync"]);
      // More output restarts the wait; the end flushes whatever is left.
      splitter.push(Buffer.from("…"));
      splitter.end();
      expect(lines).toEqual(["Waiting for the node to sync", "…"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runSteps", () => {
  it("runs the steps in order and reports success once", async () => {
    sandbox.stub("tool", '(args) => ({ out: "ran " + args[0] + "\\n" })');
    const r = await run([step("one"), step("two")]);
    expect(r.exits).toEqual([0]);
    expect(r.lines).toEqual(["$ tool one", "ran one", "$ tool two", "ran two"]);
    expect(sandbox.calls("tool")).toEqual([["one"], ["two"]]);
  });

  it("stops at the first failing step", async () => {
    sandbox.stub("tool", '(args) => ({ err: "Error: boom\\n", code: args[0] === "one" ? 3 : 0 })');
    const r = await run([step("one"), step("two")]);
    expect(r.exits).toEqual([3]);
    expect(r.lines).toEqual(["$ tool one", "Error: boom", "✖ exited with code 3"]);
    expect(sandbox.calls("tool")).toEqual([["one"]]);
  });

  it("reports a command that is not installed exactly once, with nothing after it", async () => {
    // No stub on PATH: Node emits `error` and then `close` for the failed spawn.
    const r = await run([step("one"), step("two")]);
    expect(r.exits).toEqual([1]);
    expect(r.lines).toEqual(["$ tool one", "error: tool is not installed or not on your PATH"]);
    expect(r.lines.length).toBe(r.linesAtDone);
  });

  it("strips ANSI colours and treats a carriage return as a line end", async () => {
    sandbox.stub(
      "tool",
      '() => ({ out: "\\u001b[32mgreen\\u001b[0m\\rspin 1\\rspin 2\\r\\n  last" })',
    );
    const r = await run([step("x")]);
    expect(r.lines).toEqual(["$ tool x", "green", "spin 1", "spin 2", "last"]);
  });

  it("treats a failure as benign only when its FINAL error line says so", async () => {
    const alreadyDone = /\bblockchain chain1 has already been deployed\b/i;

    sandbox.stub(
      "tool",
      `(args) =>
        args[0] === "deploy"
          ? { out: "starting\\n", err: "Error: blockchain chain1 has already been deployed\\n", code: 1 }
          : { out: "ok\\n" }`,
    );
    const benign = await run([{ ...step("deploy"), alreadyDone }, step("next")]);
    expect(benign.exits).toEqual([0]);
    expect(benign.lines).toContain("↳ already in place — continuing");
    expect(benign.lines).toContain("$ tool next");

    // The same words earlier in the output, followed by a different failure,
    // must NOT turn that failure into a success.
    sandbox.stub(
      "tool",
      `() => ({
        out: "blockchain chain1 has already been deployed\\n",
        err: "Error: relayer failed to start\\n",
        code: 1,
      })`,
    );
    const masked = await run([{ ...step("deploy"), alreadyDone }, step("next")]);
    expect(masked.exits).toEqual([1]);
    expect(masked.lines).not.toContain("$ tool next");
    expect(masked.lines.at(-1)).toBe("✖ exited with code 1");
  });

  it("fails the run when a step is killed by a signal", async () => {
    sandbox.stub("tool", '() => { process.kill(process.pid, "SIGKILL"); }');
    const r = await run([step("one"), step("two")]);
    expect(r.exits).toEqual([137]);
    expect(r.lines.at(-1)).toBe("✖ killed by SIGKILL");
    expect(sandbox.calls("tool")).toEqual([["one"]]);
  });

  it("cancel stops the command and reports once it has really exited", async () => {
    sandbox.stub(
      "tool",
      `async () => {
        process.stdout.write("started\\n");
        await new Promise((r) => setTimeout(r, 30000));
      }`,
    );
    let cancelled = false;
    const r = await run([step("one"), step("two")], (handle, lines) => {
      if (!cancelled && lines.includes("started")) {
        cancelled = true;
        handle.cancel();
        handle.cancel(); // a second cancel is a no-op
      }
    });
    expect(r.exits).toEqual([143]); // 128 + SIGTERM
    expect(r.lines.at(-1)).toBe("■ cancelled");
    expect(sandbox.calls("tool")).toEqual([["one"]]);
  });

  it("finishes at once when there is nothing to run", async () => {
    const r = await run([]);
    expect(r.exits).toEqual([0]);
    expect(r.lines).toEqual([]);
  });
});
