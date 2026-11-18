/**
 * One avalanche-cli action at a time across EVERY Studio process on this
 * machine. The dashboard and `avakit-studio mcp` are separate processes that
 * drive the same avalanche-cli, so a lock kept in memory by each of them lets
 * the two run at once — and concurrent runs against one local network corrupt
 * it. The lock is therefore a file next to Studio's other state:
 *
 *   ~/.avakit-studio/action.lock   {"pid":4242,"action":"devnet start",…}
 *
 * It is created exclusively (it either does not exist yet, or the action is
 * refused), it names its owner, and it is removed when the action ends or the
 * process exits. A lock whose owner is no longer alive is stale and is taken
 * over.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { studioStateDir } from "./paths.js";

/** Who holds the lock. */
export interface LockHolder {
  pid: number;
  /** The action in flight, as "<kind> <action>": "devnet start", "fuji deploy". */
  action: string;
  startedAt: number;
}

export type LockAttempt =
  /** The lock is ours until `release` is called (calling it twice is harmless). */
  | { acquired: true; release: () => void }
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
 */
export function busyMessage(
  holder: { action: string; pid?: number } | null,
  canCancel = false,
): string {
  const what = holder ? `Another action (${holder.action})` : "Another action";
  const where = !holder
    ? " in another Studio process"
    : holder.pid !== undefined && holder.pid !== process.pid
      ? ` in another Studio process (pid ${holder.pid})`
      : "";
  const next = canCancel ? "or cancel it" : "then retry";
  return `${what} is still running${where} — wait for it to finish, ${next}.`;
}

/** A lock file nobody can read is "being written" for this long, then stale. */
const UNREADABLE_GRACE_MS = 2000;

/** Replacing a stale lock takes microseconds; a marker older than this was left by a crash. */
const TAKEOVER_GRACE_MS = 10_000;

/** The file is hand-editable and its action text ends up in a message. */
const ACTION = /^[a-z0-9][a-z0-9 -]{0,39}$/;

interface Stored extends LockHolder {
  /** Unique per acquisition, so one process can tell its own locks apart. */
  token: string;
}

/** The locks this process holds right now: token -> release. */
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

function ageMs(file: string): number {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function parse(raw: string): Stored | null {
  try {
    const v = JSON.parse(raw) as Partial<Stored> | null;
    if (
      v &&
      typeof v === "object" &&
      Number.isSafeInteger(v.pid) &&
      (v.pid as number) > 0 &&
      typeof v.action === "string" &&
      ACTION.test(v.action) &&
      typeof v.startedAt === "number" &&
      typeof v.token === "string"
    ) {
      return { pid: v.pid as number, action: v.action, startedAt: v.startedAt, token: v.token };
    }
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

/** Release everything this process holds (it is exiting). */
export function releaseAllLocks(): void {
  for (const release of [...held.values()]) release();
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
  const mine: Stored = { pid: process.pid, action, startedAt: Date.now(), token };
  const raw = JSON.stringify(mine);
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
        const live = holder.pid === process.pid ? held.has(holder.token) : isAlive(holder.pid);
        if (live) {
          const { pid, action: theirs, startedAt } = holder;
          return { acquired: false, holder: { pid, action: theirs, startedAt } };
        }
      }
      removeStale(file, seen);
      continue;
    }

    const release = (): void => {
      if (!held.delete(token)) return;
      if (held.size === 0) watchExit(false);
      try {
        // Only ever our own lock, never whatever is at that path by now.
        if (readFileSync(file, "utf8") === raw) unlinkSync(file);
      } catch {
        // already gone
      }
    };
    if (held.size === 0) watchExit(true);
    held.set(token, release);
    return { acquired: true, release };
  }
  return { acquired: false, holder: null };
}
