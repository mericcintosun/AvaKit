import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireActionLock,
  actionLockFile,
  busyMessage,
  type LockAttempt,
  processStartTime,
  releaseAllLocks,
} from "./lock.js";

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

  it("records the command an action runs, and stays held for it when this process exits", async () => {
    const command = await otherProcess();
    const attempt = acquireActionLock("devnet start", file);
    if (!attempt.acquired) throw new Error("expected the lock");
    attempt.setCommand(command.pid);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      pid: process.pid,
      action: "devnet start",
      command: { pid: command.pid, processStart: processStartTime(command.pid) },
    });

    // This process exits (Ctrl+C, SIGTERM) while the command still runs: the
    // lock stays, and the next process is told what is still running.
    releaseAllLocks();
    expect(existsSync(file)).toBe(true);
    const refused = acquireActionLock("devnet stop", file);
    expect(refused).toMatchObject({
      acquired: false,
      holder: { pid: process.pid, action: "devnet start", orphanedCommandPid: command.pid },
    });
    expect(busyMessage(refused.acquired ? null : refused.holder, false, file)).toMatch(
      /its avalanche-cli command \(pid \d+\) was started by a Studio process \(pid \d+\) that has since exited/,
    );

    // The command ends: the lock is stale, and taken over.
    await command.stop();
    mustAcquire("devnet stop")();
    expect(existsSync(file)).toBe(false);
  });

  it("is removed on exit once the recorded command has ended", () => {
    const attempt = acquireActionLock("devnet start", file);
    if (!attempt.acquired) throw new Error("expected the lock");
    attempt.setCommand(deadPid());
    releaseAllLocks();
    expect(existsSync(file)).toBe(false);

    const again = acquireActionLock("devnet start", file);
    if (!again.acquired) throw new Error("expected the lock");
    attempt.setCommand(process.ppid); // a released attempt changes nothing
    again.setCommand(process.ppid);
    again.setCommand(null); // between two commands
    expect(JSON.parse(readFileSync(file, "utf8")).command).toBeNull();
    releaseAllLocks();
    expect(existsSync(file)).toBe(false);
  });

  it("is removed when the action ends, whatever command it recorded", async () => {
    const command = await otherProcess();
    const attempt = acquireActionLock("devnet start", file);
    if (!attempt.acquired) throw new Error("expected the lock");
    attempt.setCommand(command.pid);
    attempt.release();
    expect(existsSync(file)).toBe(false);
  });

  it("an owner that has exited holds nothing while its recorded command is gone too", () => {
    mustAcquire("devnet stop")();
    writeFileSync(
      file,
      JSON.stringify({
        pid: deadPid(),
        action: "devnet start",
        startedAt: 1,
        token: "other",
        command: { pid: deadPid(), processStart: null },
      }),
    );
    mustAcquire("devnet start")();
  });

  it("knows a process by its start time", async () => {
    const other = await otherProcess();
    const start = processStartTime(other.pid);
    if (process.platform === "win32") {
      expect(start).toBeNull();
      return;
    }
    expect(start).toEqual(expect.any(String));
    expect(processStartTime(other.pid)).toBe(start);
    await other.stop();
    expect(processStartTime(other.pid)).toBeNull();
    expect(processStartTime(-1)).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "takes over a lock whose pid now belongs to a process that started at another time",
    async () => {
      const other = await otherProcess();
      mustAcquire("devnet stop")(); // creates the directory, leaves no lock behind
      const lock = (processStart: string) =>
        writeFileSync(
          file,
          JSON.stringify({
            pid: other.pid,
            processStart,
            action: "devnet start",
            startedAt: 1,
            token: "x",
          }),
        );

      // The recorded process is the one still running under that pid: held.
      lock(processStartTime(other.pid) as string);
      expect(acquireActionLock("devnet stop", file)).toEqual({
        acquired: false,
        holder: { pid: other.pid, action: "devnet start", startedAt: 1 },
      });

      // The pid was reused (pid 1, in the gatekeeper's report): not the owner.
      lock("Thu Jan  1 00:00:00 1970");
      mustAcquire("devnet stop")();
      expect(existsSync(file)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "takes over a lock whose recorded command's pid now belongs to another process",
    async () => {
      const other = await otherProcess();
      mustAcquire("devnet stop")();
      const write = (processStart: string) =>
        writeFileSync(
          file,
          JSON.stringify({
            pid: deadPid(),
            action: "devnet start",
            startedAt: 1,
            token: "x",
            command: { pid: other.pid, processStart },
          }),
        );
      write(processStartTime(other.pid) as string);
      expect(acquireActionLock("devnet stop", file)).toMatchObject({
        acquired: false,
        holder: { orphanedCommandPid: other.pid },
      });
      write("Thu Jan  1 00:00:00 1970");
      mustAcquire("devnet stop")();
    },
  );

  it("never trusts a malformed command or start time", () => {
    mustAcquire("devnet stop")();
    for (const bad of [
      { command: { pid: "1" } },
      { command: { pid: 1, processStart: 7 } },
      { processStart: "x".repeat(65) },
    ]) {
      writeFileSync(
        file,
        JSON.stringify({
          pid: process.ppid,
          action: "devnet start",
          startedAt: 1,
          token: "t",
          ...bad,
        }),
      );
      expect(acquireActionLock("devnet start", file), JSON.stringify(bad)).toEqual({
        acquired: false,
        holder: null,
      });
      age(file, 60);
      mustAcquire("devnet start")();
    }
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
  const lockPath = "/home/dev/.avakit-studio/action.lock";
  const leftover = ` If no other Studio and no avalanche-cli command is running, the lock file ${lockPath} is left over: delete it and retry.`;

  it("is one sentence for this process's own action", () => {
    expect(busyMessage({ action: "devnet start" }, false, lockPath)).toBe(
      "Another action (devnet start) is still running — wait for it to finish, then retry.",
    );
    expect(busyMessage({ action: "devnet start", pid: process.pid }, false, lockPath)).toBe(
      "Another action (devnet start) is still running — wait for it to finish, then retry.",
    );
    expect(busyMessage({ action: "fuji deploy" }, true, lockPath)).toBe(
      "Another action (fuji deploy) is still running — wait for it to finish, or cancel it.",
    );
  });

  it("names the other process and the lock file, and says when the file may be deleted", () => {
    expect(busyMessage({ action: "devnet stop", pid: process.ppid }, false, lockPath)).toBe(
      `Another action (devnet stop) is still running in another Studio process (pid ${process.ppid}) — wait for it to finish, then retry.${leftover}`,
    );
    expect(busyMessage(null, false, lockPath)).toBe(
      `Another action is still running in another Studio process — wait for it to finish, then retry.${leftover}`,
    );
    // Studio's own lock file by default.
    expect(busyMessage(null)).toContain(actionLockFile());
  });

  it("says when only the command of a Studio that has exited is still running", () => {
    expect(
      busyMessage({ action: "devnet start", pid: 4242, orphanedCommandPid: 5151 }, false, lockPath),
    ).toBe(
      `Another action (devnet start) is still running: its avalanche-cli command (pid 5151) was started by a Studio process (pid 4242) that has since exited — wait for the command to finish, then retry.${leftover}`,
    );
  });
});
