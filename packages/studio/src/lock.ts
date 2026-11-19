/**
 * One avalanche-cli action at a time across EVERY Studio process on this
 * machine. The dashboard and `avakit-studio mcp` are separate processes that
 * drive the same avalanche-cli, so a lock kept in memory by each of them lets
 * the two run at once — and concurrent runs against one local network corrupt
 * it. The lock is therefore a file next to Studio's other state:
 *
 *   ~/.avakit-studio/action.lock
 *   {"pid":4242,"processStart":"…","action":"devnet start","startedAt":…,
 *    "token":"…","command":{"pid":5151,"processStart":"…"}}
 *
 * It is created exclusively (it either does not exist yet, or the action is
 * refused), it names its owner, and it is removed when the action ends.
 *
 * The avalanche-cli command an action runs is spawned detached, so that
 * stopping Studio (Ctrl+C) never kills a `network start` half-way. That command
 * can therefore outlive the Studio process that started it, and while it runs
 * no other action may start. So the lock also names the command in flight
 * (`command`), and it is held while EITHER its owner or that command is alive:
 * an owner that exits while its command still runs leaves the lock in place.
 *
 * "Alive" means the pid exists AND, where the operating system says when a
 * process started, it is still the process that was recorded: a pid that now
 * belongs to another process (the owner crashed long ago and the pid was
 * reused) does not hold the lock. A lock held by nobody alive is stale and is
 * taken over.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { studioStateDir } from "./paths.js";

/** Who holds the lock, as a refusal reports it. */
export interface LockHolder {
  /** The Studio process that started the action. */
  pid: number;
  /** The action in flight, as "<kind> <action>": "devnet start", "fuji deploy". */
  action: string;
  startedAt: number;
  /**
   * Set when the Studio process that started the action has exited and only
   * the avalanche-cli command it started is still running: that command's pid.
   */
  orphanedCommandPid?: number;
}

export type LockAttempt =
  | {
      acquired: true;
      /** Give the lock back: the action has ended (calling it twice is harmless). */
      release: () => void;
      /**
       * Record the avalanche-cli command now running for this action (its pid),
       * or that none is (null). The lock outlives this process while it runs.
       */
      setCommand: (pid: number | null) => void;
    }
  /** Refused. `holder` is null when the lock is only just being written or replaced. */
  | { acquired: false; holder: LockHolder | null };

/** Where the lock lives. Resolved on every call, like the other Studio paths. */
export function actionLockFile(): string {
  return path.join(studioStateDir(), "action.lock");
}

/**
 * The one refusal every face of Studio gives while an action is in flight:
 * "Another action (devnet start) is still running — wait for it to finish, …".
 * A holder with another process's pid is named as such; null is a lock that is
 * only just changing hands. `canCancel` is for the dashboard's own action,
 * which has a Cancel button.
 *
 * Whenever the lock belongs to another process (or to no process this one can
 * name), the refusal also names the lock file and says when it may be deleted:
 * a lock that is wrongly held must never leave "wait" as the only way out.
 */
export function busyMessage(
  holder: { action: string; pid?: number; orphanedCommandPid?: number } | null,
  canCancel = false,
  lockFile: string = actionLockFile(),
): string {
  const leftover = ` If no other Studio and no avalanche-cli command is running, the lock file ${lockFile} is left over: delete it and retry.`;
  if (holder?.orphanedCommandPid !== undefined) {
    return (
      `Another action (${holder.action}) is still running: its avalanche-cli command ` +
      `(pid ${holder.orphanedCommandPid}) was started by a Studio process` +
      `${holder.pid !== undefined ? ` (pid ${holder.pid})` : ""} that has since exited — ` +
      `wait for the command to finish, then retry.${leftover}`
    );
  }
  const what = holder ? `Another action (${holder.action})` : "Another action";
  const other = !holder || (holder.pid !== undefined && holder.pid !== process.pid);
  const where = !holder
    ? " in another Studio process"
    : other
      ? ` in another Studio process (pid ${holder.pid})`
      : "";
  const next = canCancel ? "or cancel it" : "then retry";
  return `${what} is still running${where} — wait for it to finish, ${next}.${other ? leftover : ""}`;
}

/** A lock file nobody can read is "being written" for this long, then stale. */
const UNREADABLE_GRACE_MS = 2000;

/** Replacing a stale lock takes microseconds; a marker older than this was left by a crash. */
const TAKEOVER_GRACE_MS = 10_000;

/** The file is hand-editable and its action text ends up in a message. */
const ACTION = /^[a-z0-9][a-z0-9 -]{0,39}$/;

/** A process start time as recorded: opaque, printable, short. */
const PROCESS_START = /^[ -~]{1,64}$/;

/** A process, identified beyond its pid where the OS allows it. */
interface ProcessRef {
  pid: number;
  /** When it started, as the OS reports it (see processStartTime); null where unknown. */
  processStart: string | null;
}

interface Stored extends ProcessRef {
  action: string;
  startedAt: number;
  /** Unique per acquisition, so one process can tell its own locks apart. */
  token: string;
  /** The avalanche-cli command the action is running right now, if any. */
  command: ProcessRef | null;
}

/** The locks this process holds right now: token -> give it back because the process is exiting. */
const held = new Map<string, () => void>();

function code(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, it just is not ours to signal.
    return code(e) === "EPERM";
  }
}

/**
 * When process `pid` started, as an opaque string that is the same for as long
 * as that process lives and differs for a later process that reuses its pid.
 * Null when it cannot be read (no such process, Windows, no `ps`).
 *
 * Linux: the start time in clock ticks since boot, from /proc/<pid>/stat.
 * macOS and the BSDs: `ps -o lstart=`, with a fixed locale and time zone so
 * that two Studio processes started from different shells read the same text.
 */
export function processStartTime(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") return null;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // Field 2 (the command name) is in parentheses and may contain spaces or
      // parentheses itself: count from the last ")". Field 22 is the start time.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ticks = fields[19];
      return ticks && /^\d+$/.test(ticks) ? ticks : null;
    } catch {
      return null;
    }
  }
  try {
    // An absolute path: Studio must not run whatever `ps` happens to be on PATH.
    const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { LC_ALL: "C", TZ: "UTC" },
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const text = result.status === 0 ? result.stdout.trim().replace(/\s+/g, " ") : "";
    return PROCESS_START.test(text) ? text : null;
  } catch {
    return null;
  }
}

let ownStart: string | null | undefined;
function ownProcessStart(): string | null {
  if (ownStart === undefined) ownStart = processStartTime(process.pid);
  return ownStart;
}

/**
 * Whether the process recorded as `ref` is still running. A pid that is alive
 * but started at another time than recorded is another process that reused the
 * pid. When either start time is unknown, the pid alone decides.
 */
function isRunning(ref: ProcessRef): boolean {
  if (!isAlive(ref.pid)) return false;
  if (ref.processStart === null) return true;
  const now = processStartTime(ref.pid);
  return now === null || now === ref.processStart;
}

function ageMs(file: string): number {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function parseRef(v: unknown): ProcessRef | null | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { pid, processStart } = v as Partial<ProcessRef>;
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return undefined;
  // Absent (a lock from an older Studio) is the same as unknown.
  if (processStart === undefined || processStart === null)
    return { pid: pid as number, processStart: null };
  if (typeof processStart !== "string" || !PROCESS_START.test(processStart)) return undefined;
  return { pid: pid as number, processStart };
}

function parse(raw: string): Stored | null {
  try {
    const v = JSON.parse(raw) as Partial<Stored> | null;
    if (
      !v ||
      typeof v !== "object" ||
      typeof v.action !== "string" ||
      !ACTION.test(v.action) ||
      typeof v.startedAt !== "number" ||
      typeof v.token !== "string"
    ) {
      return null;
    }
    const owner = parseRef(v);
    if (!owner) return null;
    let command: ProcessRef | null = null;
    if (v.command !== undefined && v.command !== null) {
      const parsed = parseRef(v.command);
      if (!parsed) return null;
      command = parsed;
    }
    return { ...owner, action: v.action, startedAt: v.startedAt, token: v.token, command };
  } catch {
    // not JSON (yet)
  }
  return null;
}

/**
 * Remove the stale lock whose content is `raw`. Only one process at a time may
 * do this — it holds a short-lived marker meanwhile — and it looks again first:
 * without that, two processes that both saw the same stale lock could each
 * remove it, the second one removing the lock the first had just taken.
 */
function removeStale(file: string, raw: string): void {
  const marker = `${file}.takeover`;
  try {
    writeFileSync(marker, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (code(e) !== "EEXIST") throw e;
    // Another process is replacing the lock right now (the caller looks again).
    if (ageMs(marker) > TAKEOVER_GRACE_MS) {
      try {
        unlinkSync(marker);
      } catch {
        // already gone
      }
    }
    return;
  }
  try {
    if (readFileSync(file, "utf8") === raw) unlinkSync(file);
  } catch {
    // already gone
  } finally {
    try {
      unlinkSync(marker);
    } catch {
      // already gone
    }
  }
}

/**
 * This process is exiting: give back every lock it holds — except one whose
 * avalanche-cli command is still running, which stays held for that command.
 */
export function releaseAllLocks(): void {
  for (const exiting of [...held.values()]) exiting();
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function onSignal(signal: NodeJS.Signals): void {
  releaseAllLocks(); // …which also takes this handler off again
  // Listening for a signal switches off its default action (ending the
  // process). If nothing else is listening, that is still what must happen.
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

/** While a lock is held, release it when the process ends — however it ends. */
function watchExit(on: boolean): void {
  if (on) {
    process.on("exit", releaseAllLocks);
    for (const signal of SIGNALS) process.on(signal, onSignal);
  } else {
    process.off("exit", releaseAllLocks);
    for (const signal of SIGNALS) process.off(signal, onSignal);
  }
}

/**
 * Take the action lock for `action` ("<kind> <action>"). Never waits: the lock
 * is either free (or stale) and taken, or the attempt is refused with whoever
 * holds it. Throws only when the lock file cannot be written at all.
 */
export function acquireActionLock(action: string, file: string = actionLockFile()): LockAttempt {
  const token = randomBytes(8).toString("hex");
  let mine: Stored = {
    pid: process.pid,
    processStart: ownProcessStart(),
    action,
    startedAt: Date.now(),
    token,
    command: null,
  };
  let raw = JSON.stringify(mine);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch (e) {
    throw new Error(`could not take Studio's action lock (${file}): ${(e as Error).message}`);
  }

  // A few rounds: each one either takes the lock, refuses, or has cleared a
  // stale lock (or lost a race for one) and looks again.
  for (let round = 0; round < 4; round++) {
    try {
      writeFileSync(file, raw, { flag: "wx" });
    } catch (e) {
      if (code(e) !== "EEXIST") {
        throw new Error(`could not take Studio's action lock (${file}): ${(e as Error).message}`);
      }
      let seen: string;
      try {
        seen = readFileSync(file, "utf8");
      } catch {
        continue; // released in between
      }
      const holder = parse(seen);
      if (!holder) {
        // Created but not written yet — or garbage, which does not stay "new".
        if (ageMs(file) < UNREADABLE_GRACE_MS) return { acquired: false, holder: null };
      } else {
        // Our own pid on a lock this process does not hold is a leftover from
        // an earlier process that happened to have the same pid.
        const ownerLive = holder.pid === process.pid ? held.has(holder.token) : isRunning(holder);
        const { pid, action: theirs, startedAt } = holder;
        if (ownerLive) return { acquired: false, holder: { pid, action: theirs, startedAt } };
        // The owner is gone, but the avalanche-cli command it started is not.
        if (holder.command && isRunning(holder.command)) {
          return {
            acquired: false,
            holder: { pid, action: theirs, startedAt, orphanedCommandPid: holder.command.pid },
          };
        }
      }
      removeStale(file, seen);
      continue;
    }

    /** Remove the lock, if what is at that path is still ours. */
    const remove = (): void => {
      try {
        if (readFileSync(file, "utf8") === raw) unlinkSync(file);
      } catch {
        // already gone
      }
    };
    const drop = (exiting: boolean): void => {
      if (!held.delete(token)) return;
      if (held.size === 0) watchExit(false);
      // The process is going, its command is not: the lock stays, for the
      // command. Whoever looks next takes it over once the command has ended.
      if (exiting && mine.command && isRunning(mine.command)) return;
      remove();
    };
    const release = (): void => drop(false);
    const setCommand = (pid: number | null): void => {
      if (!held.has(token)) return;
      const next: Stored = {
        ...mine,
        command: pid === null ? null : { pid, processStart: processStartTime(pid) },
      };
      const nextRaw = JSON.stringify(next);
      const tmp = `${file}.${token}.tmp`;
      try {
        // Only ever our own lock. Written aside and renamed into place, so a
        // reader never sees it half-written.
        if (readFileSync(file, "utf8") !== raw) return;
        writeFileSync(tmp, nextRaw);
        renameSync(tmp, file);
        mine = next;
        raw = nextRaw;
      } catch {
        // Best effort: the lock still holds while this process lives.
        try {
          unlinkSync(tmp);
        } catch {
          // never written
        }
      }
    };
    if (held.size === 0) watchExit(true);
    held.set(token, () => drop(true));
    return { acquired: true, release, setCommand };
  }
  return { acquired: false, holder: null };
}
