import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createProcessRegistry, type ProcessRegistry } from "./processes.js";
import { createShutdown, installShutdown, type ShutdownOptions } from "./shutdown.js";

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

/** A command that runs until it is stopped; `stubborn` ignores SIGTERM. */
async function command(
  registry: ProcessRegistry,
  label: string,
  stubborn = false,
): Promise<{ pid: number; ended: Promise<NodeJS.Signals | number | null> }> {
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
  await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
  registry.trackCommand(child, label);
  return { pid: child.pid as number, ended };
}

/** A shutdown that records what it says and how it would exit, instead of exiting. */
function recorded(options: Partial<ShutdownOptions> = {}) {
  const registry = options.registry ?? createProcessRegistry();
  const said: string[] = [];
  const exits: number[] = [];
  let closed = 0;
  const shutdown = createShutdown({
    write: (text) => said.push(text),
    close: () => {
      closed++;
    },
    exit: (code) => exits.push(code),
    ...options,
    registry,
  });
  return { shutdown, registry, said: () => said.join(""), exits, closed: () => closed };
}

describe("stopping Studio", () => {
  it("closes, stops what it started, says what keeps running, then exits 130 after Ctrl+C", async () => {
    const registry = createProcessRegistry();
    const start = await command(registry, "avalanche network start");
    const { shutdown, said, exits, closed } = recorded({
      registry,
      stillRunning: async () => ["The local Avalanche network keeps running."],
    });

    await shutdown.stop("SIGINT");

    expect(closed()).toBe(1);
    expect(await start.ended).toBe("SIGTERM");
    expect(exits).toEqual([130]);
    expect(said()).toBe(
      [
        "",
        "Stopping Studio and what it started (Ctrl+C again kills it at once):",
        `  avalanche network start (pid ${start.pid})`,
        `Stopped avalanche network start (pid ${start.pid}).`,
        "The local Avalanche network keeps running.",
        "",
      ].join("\n"),
    );
  });

  it("exits with the code of what stopped it, and says nothing when nothing ran", async () => {
    for (const [reason, code] of [
      ["SIGTERM", 143],
      ["SIGHUP", 129],
      ["disconnected", 0],
    ] as const) {
      const { shutdown, said, exits } = recorded({ stillRunning: async () => [] });
      await shutdown.stop(reason);
      expect(exits, reason).toEqual([code]);
      expect(said(), reason).toBe("");
    }
  });

  it("kills what still runs at a second Ctrl+C, and exits only once", async () => {
    const registry = createProcessRegistry();
    const stubborn = await command(registry, "avalanche blockchain deploy chain1 --local", true);
    const { shutdown, said, exits } = recorded({ registry, graceMs: 20_000 });

    const first = shutdown.stop("SIGINT");
    // The first stop has asked it to go, and it has not.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(exits).toEqual([]);

    await shutdown.stop("SIGINT");
    expect(await stubborn.ended).toBe("SIGKILL");
    expect(exits).toEqual([130]);
    expect(said()).toContain(
      `Killed avalanche blockchain deploy chain1 --local (pid ${stubborn.pid}).`,
    );

    await first;
    expect(exits).toEqual([130]);
    expect(said()).not.toContain("Stopped ");
  });

  it("takes the connection closing again, while it stops, as nothing new", async () => {
    const registry = createProcessRegistry();
    const start = await command(registry, "avalanche network start");
    const { shutdown, exits } = recorded({ registry });
    await Promise.all([shutdown.stop("disconnected"), shutdown.stop("disconnected")]);
    expect(await start.ended).toBe("SIGTERM");
    expect(exits).toEqual([0]);
  });

  it("does not wait forever for a server that will not close, or a look that never ends", async () => {
    const { shutdown, exits } = recorded({
      close: () => new Promise<void>(() => {}),
      stillRunning: () => new Promise<string[]>(() => {}),
    });
    const before = Date.now();
    await shutdown.stop("SIGTERM");
    expect(exits).toEqual([143]);
    expect(Date.now() - before).toBeLessThan(10_000);
  });

  it("still exits when the look at what keeps running fails", async () => {
    const { shutdown, said, exits } = recorded({
      stillRunning: async () => {
        throw new Error("no network");
      },
    });
    await shutdown.stop("SIGINT");
    expect(exits).toEqual([130]);
    expect(said()).toBe("");
  });

  it("stops what it started, and exits, when nothing can be told about it any more", async () => {
    const registry = createProcessRegistry();
    const start = await command(registry, "avalanche network start");
    let writes = 0;
    const { shutdown, exits } = recorded({
      registry,
      write: () => {
        writes++;
        throw new Error("write EIO");
      },
      stillRunning: async () => ["The local Avalanche network keeps running."],
    });

    await shutdown.stop("SIGHUP");

    expect(await start.ended).toBe("SIGTERM");
    expect(exits).toEqual([129]);
    // It went on saying each part after the first write failed.
    expect(writes).toBe(3);
  });
});

describe("installShutdown", () => {
  it("listens for SIGINT, SIGTERM, SIGHUP, the process's exit and write errors only while installed", () => {
    const count = () => [
      ...(["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const).map((s) => process.listenerCount(s)),
      process.stdout.listenerCount("error"),
      process.stderr.listenerCount("error"),
    ];
    const before = count();
    const installed = installShutdown({
      write: () => {},
      exit: () => {},
      registry: createProcessRegistry(),
    });
    expect(count()).toEqual(before.map((n) => n + 1));
    installed.uninstall();
    expect(count()).toEqual(before);
  });
});
