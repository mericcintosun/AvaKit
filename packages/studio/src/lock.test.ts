import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireActionLock, busyMessage, type LockAttempt, releaseAllLocks } from "./lock.js";

// Every test gets its own lock file in a temporary directory: the real one
// (~/.avakit-studio/action.lock) is never touched.
let dir: string;
let file: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "avakit-studio-lock-"));
  file = path.join(dir, "state", "action.lock");
});
afterEach(() => {
  releaseAllLocks();
  for (const child of children.splice(0)) child.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
});

function mustAcquire(action: string): () => void {
  const attempt = acquireActionLock(action, file);
  if (!attempt.acquired) throw new Error(`expected the lock, got ${JSON.stringify(attempt)}`);
  return attempt.release;
}

/** A lock file as another Studio process would have written it. */
function writeLock(pid: number, action = "devnet start"): void {
  mustAcquire("devnet stop")(); // creates the directory, leaves no lock behind
  writeFileSync(file, JSON.stringify({ pid, action, startedAt: 1, token: "other" }));
}

/** Another process, alive until the test (or `stop`) ends it. */
async function otherProcess(): Promise<{ pid: number; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  return {
    pid: child.pid as number,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGKILL");
      }),
  };
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

const age = (target: string, seconds: number): void => {
  const then = new Date(Date.now() - seconds * 1000);
  utimesSync(target, then, then);
};

describe("action lock", () => {
  it("is a file that names its owner, and is gone once released", () => {
    const release = mustAcquire("devnet start");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      pid: process.pid,
      action: "devnet start",
    });
    release();
    expect(existsSync(file)).toBe(false);
    release(); // twice is harmless
  });

  it("refuses a second holder and says who is in the way", () => {
    const release = mustAcquire("devnet create-icm");
    const second = acquireActionLock("fuji deploy", file);
    expect(second).toMatchObject({
      acquired: false,
      holder: { pid: process.pid, action: "devnet create-icm" },
    });
    // The refused attempt left the holder's lock alone.
    expect(JSON.parse(readFileSync(file, "utf8")).action).toBe("devnet create-icm");

    release();
    mustAcquire("fuji deploy")();
  });

  it("is held by another process for exactly as long as that process lives", async () => {
    const other = await otherProcess();
    writeLock(other.pid, "devnet start");
    expect(acquireActionLock("devnet stop", file)).toEqual({
      acquired: false,
      holder: { pid: other.pid, action: "devnet start", startedAt: 1 },
    });

    // Its owner is gone (crashed, killed, closed): the lock is stale, and taken over.
    await other.stop();
    const release = mustAcquire("devnet stop");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      pid: process.pid,
      action: "devnet stop",
    });
    release();
    expect(existsSync(file)).toBe(false);
  });

  it("takes over a lock left behind by a process that no longer exists", () => {
    writeLock(deadPid());
    mustAcquire("devnet start")();
  });

  it("takes over a lock with this process's own pid that this process does not hold", () => {
    // Left by an earlier process that happened to get the same pid.
    writeLock(process.pid);
    mustAcquire("devnet start")();
  });

  it("treats a lock it cannot read as being written, but not for long", () => {
    mustAcquire("devnet stop")();
    for (const garbage of ["", "{", "null", '{"pid":"1","action":"x"}']) {
      writeFileSync(file, garbage);
      expect(acquireActionLock("devnet start", file), garbage).toEqual({
        acquired: false,
        holder: null,
      });
      age(file, 60);
      mustAcquire("devnet start")();
    }
  });

  it("never passes on an action text it would not have written itself", () => {
    const pid = process.ppid; // alive, and not this process
    mustAcquire("devnet stop")();
    writeFileSync(
      file,
      JSON.stringify({ pid, action: "<script>alert(1)</script>", startedAt: 1, token: "t" }),
    );
    expect(acquireActionLock("devnet start", file)).toEqual({ acquired: false, holder: null });
  });

  it("lets only one process at a time replace a stale lock", () => {
    writeLock(deadPid());
    // Another process is in the middle of replacing it.
    writeFileSync(`${file}.takeover`, "4242");
    expect(acquireActionLock("devnet start", file)).toEqual({ acquired: false, holder: null });
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe("other");

    // A marker that old was left by a crash: it is cleared, then the lock is.
    age(`${file}.takeover`, 60);
    mustAcquire("devnet start")();
    expect(existsSync(`${file}.takeover`)).toBe(false);
  });

  it("release removes only its own lock", () => {
    const release = mustAcquire("devnet start");
    // Something else is at that path by now.
    const other = JSON.stringify({
      pid: process.ppid,
      action: "fuji deploy",
      startedAt: 1,
      token: "t",
    });
    writeFileSync(file, other);
    release();
    expect(readFileSync(file, "utf8")).toBe(other);
  });

  it("gives everything back when the process is about to exit", () => {
    const listening = (signal: NodeJS.Signals) => process.listenerCount(signal);
    const before = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map(listening);
    const exits = process.listenerCount("exit");

    mustAcquire("devnet start");
    // While it holds a lock, the process watches for its own end …
    expect((["SIGINT", "SIGTERM", "SIGHUP"] as const).map(listening)).toEqual(
      before.map((n) => n + 1),
    );
    expect(process.listenerCount("exit")).toBe(exits + 1);

    // … and what it runs then leaves no lock behind, and stops watching.
    releaseAllLocks();
    expect(existsSync(file)).toBe(false);
    expect((["SIGINT", "SIGTERM", "SIGHUP"] as const).map(listening)).toEqual(before);
    expect(process.listenerCount("exit")).toBe(exits);
    const next: LockAttempt = acquireActionLock("devnet stop", file);
    expect(next.acquired).toBe(true);
  });

  it("fails loudly when the lock file cannot be written at all", () => {
    // A regular file where the state directory should be.
    writeFileSync(path.join(dir, "state"), "");
    expect(() => acquireActionLock("devnet start", file)).toThrow(
      /could not take Studio's action lock/,
    );
  });
});

describe("busyMessage", () => {
  it("is one sentence for every face, with the process named when it is another one", () => {
    expect(busyMessage({ action: "devnet start" })).toBe(
      "Another action (devnet start) is still running — wait for it to finish, then retry.",
    );
    expect(busyMessage({ action: "devnet start", pid: process.pid })).toBe(
      "Another action (devnet start) is still running — wait for it to finish, then retry.",
    );
    expect(busyMessage({ action: "fuji deploy" }, true)).toBe(
      "Another action (fuji deploy) is still running — wait for it to finish, or cancel it.",
    );
    expect(busyMessage({ action: "devnet stop", pid: process.ppid })).toBe(
      `Another action (devnet stop) is still running in another Studio process (pid ${process.ppid}) — wait for it to finish, then retry.`,
    );
    expect(busyMessage(null)).toBe(
      "Another action is still running in another Studio process — wait for it to finish, then retry.",
    );
  });
});
