import { describe, expect, it } from "vitest";
import { createRunManager, type Launch, MAX_LOG_LINES, type RunInfo } from "./runs.js";

/** A launch whose output and end the test controls by hand. */
function manual() {
  let onLine: (line: string) => void = () => {};
  let onDone: (exitCode: number) => void = () => {};
  let cancels = 0;
  const launch: Launch = (line, done) => {
    onLine = line;
    onDone = done;
    return {
      cancel: () => {
        cancels++;
      },
    };
  };
  return {
    launch,
    line: (l: string) => onLine(l),
    done: (code: number) => onDone(code),
    cancels: () => cancels,
  };
}

const spec = { kind: "devnet" as const, action: "create-icm" };

describe("run manager", () => {
  it("starts a run and reports it as the current one", () => {
    const runs = createRunManager();
    expect(runs.current()).toBeNull();
    const m = manual();
    const started = runs.start({ ...spec, params: { name: "mychain" } }, m.launch);
    expect(started.started).toBe(true);
    expect(started.run).toMatchObject({
      id: 1,
      kind: "devnet",
      action: "create-icm",
      params: { name: "mychain" },
      status: "running",
      exitCode: null,
      cancelled: false,
      finishedAt: null,
    });
    expect(runs.current()).toEqual(started.run);
  });

  it("refuses a second action while one is in flight, and never launches it", () => {
    const runs = createRunManager();
    const first = manual();
    runs.start(spec, first.launch);

    let launched = false;
    const second = runs.start({ kind: "fuji", action: "deploy" }, () => {
      launched = true;
      return { cancel: () => {} };
    });
    expect(second.started).toBe(false);
    expect(second.run).toMatchObject({ id: 1, action: "create-icm", status: "running" });
    expect(launched).toBe(false);

    // Once the first one is done the lock is free again.
    first.done(0);
    const third = runs.start({ kind: "fuji", action: "deploy" }, manual().launch);
    expect(third.started).toBe(true);
    expect(third.run.id).toBe(2);
  });

  it("replays the log to a late subscriber, then streams live lines and the end", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    m.line("one");
    m.line("two");

    const lines: string[] = [];
    const ends: RunInfo[] = [];
    const attachment = runs.attach({ onLine: (l) => lines.push(l), onDone: (r) => ends.push(r) });
    expect(attachment?.log).toEqual(["one", "two"]);
    expect(attachment?.run.status).toBe("running");

    m.line("three");
    m.done(0);
    expect(lines).toEqual(["three"]);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ status: "done", exitCode: 0, cancelled: false });
    expect(ends[0]?.finishedAt).not.toBeNull();
  });

  it("keeps running when every subscriber has gone away", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    const lines: string[] = [];
    const attachment = runs.attach({ onLine: (l) => lines.push(l), onDone: () => {} });
    m.line("seen");
    attachment?.detach();
    m.line("unseen");

    // Detaching is not cancelling.
    expect(m.cancels()).toBe(0);
    expect(runs.current()?.status).toBe("running");
    expect(lines).toEqual(["seen"]);

    // A client that comes back gets everything it missed.
    expect(runs.attach({ onLine: () => {}, onDone: () => {} })?.log).toEqual(["seen", "unseen"]);
  });

  it("keeps a finished run (with its log) until it is dismissed", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    m.line("output");
    m.done(3);

    const attachment = runs.attach({ onLine: () => {}, onDone: () => {} });
    expect(attachment?.run).toMatchObject({ status: "done", exitCode: 3 });
    expect(attachment?.log).toEqual(["output"]);

    expect(runs.dismiss()).toBe(true);
    expect(runs.current()).toBeNull();
    expect(runs.attach({ onLine: () => {}, onDone: () => {} })).toBeNull();
  });

  it("does not dismiss a run that is still in flight", () => {
    const runs = createRunManager();
    runs.start(spec, manual().launch);
    expect(runs.dismiss()).toBe(false);
    expect(runs.current()?.status).toBe("running");
  });

  it("cancel signals the action once and marks the run cancelled when it ends", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    runs.cancel();
    runs.cancel();
    expect(m.cancels()).toBe(1);
    // Still running until the process has really exited.
    expect(runs.current()?.status).toBe("running");
    m.done(143);
    expect(runs.current()).toMatchObject({ status: "done", exitCode: 143, cancelled: true });
    expect(runs.cancel()).toMatchObject({ status: "done" });
  });

  it("ignores output and a second end after the run is done", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    m.done(1);
    m.line("late");
    m.done(0);
    expect(runs.current()).toMatchObject({ status: "done", exitCode: 1 });
    expect(runs.attach({ onLine: () => {}, onDone: () => {} })?.log).toEqual([]);
  });

  it("handles an action that fails before it even starts", () => {
    const runs = createRunManager();
    // Finishes synchronously, inside launch.
    const sync = runs.start(spec, (onLine, onDone) => {
      onLine("✖ invalid parameters");
      onDone(1);
      return { cancel: () => {} };
    });
    expect(sync).toMatchObject({ started: true, run: { status: "done", exitCode: 1 } });

    // Throws instead of launching: reported as a failed run, and the lock is free.
    const thrown = runs.start(spec, () => {
      throw new Error("no such action");
    });
    expect(thrown).toMatchObject({ started: true, run: { status: "done", exitCode: 1 } });
    expect(runs.attach({ onLine: () => {}, onDone: () => {} })?.log).toEqual([
      "error: no such action",
    ]);
    expect(runs.start(spec, manual().launch).started).toBe(true);
  });

  it("a subscriber that throws cannot break the run or the other subscribers", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    const lines: string[] = [];
    runs.attach({
      onLine: () => {
        throw new Error("closed connection");
      },
      onDone: () => {
        throw new Error("closed connection");
      },
    });
    runs.attach({ onLine: (l) => lines.push(l), onDone: () => lines.push("<done>") });
    m.line("still delivered");
    m.done(0);
    expect(lines).toEqual(["still delivered", "<done>"]);
    expect(runs.current()?.status).toBe("done");
  });

  it("keeps only the tail of a very long log", () => {
    const runs = createRunManager();
    const m = manual();
    runs.start(spec, m.launch);
    for (let i = 0; i < MAX_LOG_LINES + 25; i++) m.line(`line ${i}`);
    const log = runs.attach({ onLine: () => {}, onDone: () => {} })?.log ?? [];
    expect(log).toHaveLength(MAX_LOG_LINES);
    expect(log[0]).toBe("line 25");
    expect(log.at(-1)).toBe(`line ${MAX_LOG_LINES + 24}`);
  });

  it("hands out copies, so a caller cannot change the run from outside", () => {
    const runs = createRunManager();
    const started = runs.start({ ...spec, params: { name: "a" } }, manual().launch);
    started.run.status = "done";
    started.run.params.name = "changed";
    expect(runs.current()).toMatchObject({ status: "running", params: { name: "a" } });
  });
});
