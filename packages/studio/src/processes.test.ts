import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProcessRegistry } from "./processes.js";
import { runSteps, STOPPING_LINE, type Step } from "./steps.js";
import { createSandbox, type Sandbox } from "./testing/sandbox.js";

let sandbox: Sandbox;
const children: ChildProcess[] = [];
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  sandbox.dispose();
});

interface Child {
  child: ChildProcess;
  pid: number;
  /** How it ended: the signal that killed it, or its exit code. */
  ended: Promise<NodeJS.Signals | number | null>;
}

/** A process that runs until it is stopped; `stubborn` ignores SIGTERM. */
async function sleeper(stubborn = false): Promise<Child> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `${stubborn ? "process.on('SIGTERM', () => {});" : ""} process.stdout.write("ready"); setInterval(() => {}, 1000);`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  children.push(child);
  const ended = new Promise<NodeJS.Signals | number | null>((resolve) =>
    child.once("exit", (code, signal) => resolve(signal ?? code)),
  );
  // Ready once its handler (if any) is in place.
  await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
  return { child, pid: child.pid as number, ended };
}

const step = (...args: string[]): Step => ({ cmd: "tool", args });

/** A stub `tool` that says it started, then runs until it is stopped. */
function slowTool(): void {
  sandbox.stub(
    "tool",
    `async () => {
      process.stdout.write("started\\n");
      await new Promise((r) => setTimeout(r, 30000));
    }`,
  );
}

describe("process registry", () => {
  it("tracks a command from its spawn until it exits", async () => {
    const registry = createProcessRegistry();
    const one = await sleeper();
    registry.trackCommand(one.child, "sleeper one");
    expect(registry.running()).toEqual([{ pid: one.pid, label: "sleeper one" }]);
    one.child.kill("SIGKILL");
    await one.ended;
    await registry.settled(5000);
    expect(registry.running()).toEqual([]);
  });

  it("never tracks a process that did not start", async () => {
    const registry = createProcessRegistry();
    const missing = spawn("avakit-studio-no-such-command", [], { stdio: "ignore" });
    const failed = new Promise((resolve) => missing.once("error", resolve));
    registry.trackCommand(missing, "missing");
    expect(registry.running()).toEqual([]);
    await failed;
  });

  it("stops every command: SIGTERM first, SIGKILL for one that ignores it", async () => {
    const registry = createProcessRegistry();
    const polite = await sleeper();
    const stubborn = await sleeper(true);
    registry.trackCommand(polite.child, "polite");
    registry.trackCommand(stubborn.child, "stubborn");

    const report = await registry.stopAll(300, 3000);
    expect(registry.isStopping()).toBe(true);
    expect(await polite.ended).toBe("SIGTERM");
    expect(await stubborn.ended).toBe("SIGKILL");
    expect(report).toEqual({
      stopped: [
        { pid: polite.pid, label: "polite" },
        { pid: stubborn.pid, label: "stubborn" },
      ],
      left: [],
    });
  });

  it("stops a command that is started while it is stopping, at once", async () => {
    const registry = createProcessRegistry();
    await registry.stopAll(300, 300);
    const late = await sleeper();
    registry.trackCommand(late.child, "late");
    expect(await late.ended).toBe("SIGTERM");
  });

  it("kills everything at once on signalAll", async () => {
    const registry = createProcessRegistry();
    const stubborn = await sleeper(true);
    registry.trackCommand(stubborn.child, "stubborn");
    expect(registry.signalAll("SIGKILL")).toEqual([{ pid: stubborn.pid, label: "stubborn" }]);
    expect(await stubborn.ended).toBe("SIGKILL");
    expect(registry.isStopping()).toBe(true);
  });
});

describe("runSteps and stopping", () => {
  it("cancels a run that is in flight: its command is stopped and its next step never starts", async () => {
    slowTool();
    const registry = createProcessRegistry();
    const lines: string[] = [];
    let started: () => void = () => {};
    const isStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const done = new Promise<number>((resolve) => {
      runSteps(
        [step("one"), step("two")],
        (line) => {
          lines.push(line);
          if (line === "started") started();
        },
        resolve,
        undefined,
        registry,
      );
    });
    await isStarted;
    const [running] = registry.running();
    expect(running?.label).toBe("tool one");

    const report = await registry.stopAll();
    expect(await done).toBe(143); // 128 + SIGTERM
    expect(lines.at(-1)).toBe("■ cancelled");
    expect(sandbox.calls("tool")).toEqual([["one"]]);
    expect(report).toEqual({ stopped: [running], left: [] });
  });

  it("starts nothing once Studio is stopping", async () => {
    slowTool();
    const registry = createProcessRegistry();
    await registry.stopAll();
    const lines: string[] = [];
    const exitCode = await new Promise<number>((resolve) => {
      runSteps([step("one")], (line) => lines.push(line), resolve, undefined, registry);
    });
    expect(exitCode).toBe(143);
    expect(lines).toEqual([STOPPING_LINE]);
    expect(sandbox.calls("tool")).toEqual([]);
    await registry.settled(1000);
    expect(registry.running()).toEqual([]);
  });

  it("lets go of a run once it has ended on its own", async () => {
    sandbox.stub("tool", '() => ({ out: "ok\\n" })');
    const registry = createProcessRegistry();
    await new Promise<number>((resolve) => {
      runSteps([step("one")], () => {}, resolve, undefined, registry);
    });
    await registry.settled(5000);
    expect(registry.running()).toEqual([]);
    // Nothing is left to stop: stopping is immediate.
    const before = Date.now();
    expect(await registry.stopAll()).toEqual({ stopped: [], left: [] });
    expect(Date.now() - before).toBeLessThan(1000);
  });
});
