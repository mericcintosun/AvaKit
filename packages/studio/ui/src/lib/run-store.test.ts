import { describe, expect, it } from "vitest";
import {
  createRunStore,
  MAX_LOG_LINES,
  type RunBackend,
  RunBusyError,
  type RunInfo,
  type RunStreamHandlers,
} from "./run-store";

function runInfo(patch: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 1,
    kind: "devnet",
    action: "create-icm",
    params: {},
    status: "running",
    exitCode: null,
    cancelled: false,
    startedAt: 1,
    finishedAt: null,
    ...patch,
  };
}
const finished = (patch: Partial<RunInfo> = {}) =>
  runInfo({ status: "done", exitCode: 0, finishedAt: 2, ...patch });

interface FakeStream {
  handlers: RunStreamHandlers;
  closed: boolean;
}

/** A stand-in for the Studio server: the test plays its part by hand. */
function fakeServer() {
  const streams: FakeStream[] = [];
  const state = {
    run: null as RunInfo | null,
    /** When set, the next start is refused in favour of this running action. */
    busyWith: null as RunInfo | null,
    unreachable: false,
    dismissFails: false,
    cancels: 0,
    dismissals: 0,
  };
  const backend: RunBackend = {
    fetchRun: async () => {
      if (state.unreachable) throw new Error("offline");
      return state.run;
    },
    startRun: async (request) => {
      if (state.busyWith) {
        return { started: false, run: state.busyWith, error: "another action is running" };
      }
      state.run = runInfo({
        id: (state.run?.id ?? 0) + 1,
        kind: request.kind,
        action: request.action,
      });
      return { started: true, run: state.run };
    },
    cancelRun: async () => {
      state.cancels++;
    },
    dismissRun: async () => {
      if (state.dismissFails) throw new Error("an action is still running");
      state.dismissals++;
      state.run = null;
    },
    openStream: (handlers) => {
      const stream: FakeStream = { handlers, closed: false };
      streams.push(stream);
      return {
        close: () => {
          stream.closed = true;
        },
      };
    },
  };
  return {
    backend,
    state,
    streams,
    /** The connection the store is following right now. */
    live: () => streams.filter((s) => !s.closed).at(-1) as FakeStream,
    open: () => streams.filter((s) => !s.closed).length,
  };
}

describe("run store", () => {
  it("follows an action it started: log, then the end", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const ended: RunInfo[] = [];
    store.onFinished((run) => ended.push(run));

    const run = await store.start({ kind: "devnet", action: "create-icm" });
    expect(store.getSnapshot()).toEqual({ run, log: [], lost: false });
    expect(server.open()).toBe(1);

    const stream = server.live();
    stream.handlers.onSnapshot(run, ["$ avalanche blockchain create chain1"]);
    stream.handlers.onLine("creating…");
    expect(store.getSnapshot().log).toEqual(["$ avalanche blockchain create chain1", "creating…"]);

    stream.handlers.onDone(finished());
    expect(store.getSnapshot().run).toMatchObject({ status: "done", exitCode: 0 });
    expect(store.getSnapshot().log).toHaveLength(2);
    expect(ended).toHaveLength(1);
    expect(server.open()).toBe(0);
  });

  it("is not tied to whoever is watching (a view may unmount and remount)", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    let renders = 0;
    const unsubscribe = store.subscribe(() => renders++);
    await store.start({ kind: "devnet", action: "create-icm" });
    server.live().handlers.onSnapshot(runInfo(), ["one"]);
    unsubscribe(); // the Devnet view goes away

    server.live().handlers.onLine("two");
    expect(server.open()).toBe(1);

    // …and comes back: everything is still there, and the run is still "running".
    const seen = renders;
    store.subscribe(() => renders++);
    expect(store.getSnapshot()).toMatchObject({ run: { status: "running" }, log: ["one", "two"] });
    server.live().handlers.onLine("three");
    expect(renders).toBe(seen + 1);
  });

  it("re-attaches to a running action after a reload and gets its whole log back", async () => {
    const server = fakeServer();
    server.state.run = runInfo({ kind: "fuji", action: "deploy", params: { name: "myfujil1" } });
    // A brand-new store, as after a page reload.
    const store = createRunStore(server.backend);
    const ended: RunInfo[] = [];
    store.onFinished((run) => ended.push(run));

    await store.sync();
    expect(server.open()).toBe(1);
    server.live().handlers.onSnapshot(server.state.run, ["line 1", "line 2"]);
    expect(store.getSnapshot()).toMatchObject({
      run: { kind: "fuji", action: "deploy", status: "running" },
      log: ["line 1", "line 2"],
    });

    server.live().handlers.onLine("line 3");
    server.live().handlers.onDone(finished({ kind: "fuji", action: "deploy" }));
    expect(store.getSnapshot().log).toEqual(["line 1", "line 2", "line 3"]);
    expect(ended).toHaveLength(1);
  });

  it("restores an action that ended while no tab was open, without announcing it again", async () => {
    const server = fakeServer();
    const done = finished({ kind: "fuji", action: "deploy", exitCode: 1 });
    server.state.run = done;
    const store = createRunStore(server.backend);
    const ended: RunInfo[] = [];
    store.onFinished((run) => ended.push(run));

    await store.sync();
    const stream = server.live();
    stream.handlers.onSnapshot(done, ["$ avalanche blockchain deploy", "✖ exited with code 1"]);
    stream.handlers.onDone(done);

    expect(store.getSnapshot()).toEqual({
      run: done,
      log: ["$ avalanche blockchain deploy", "✖ exited with code 1"],
      lost: false,
    });
    expect(ended).toEqual([]);
    expect(server.open()).toBe(0);

    // Polling again changes nothing and opens nothing.
    await store.sync();
    expect(server.streams).toHaveLength(1);
  });

  it("replaces the log on a reconnect instead of duplicating it", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const run = await store.start({ kind: "devnet", action: "start" });
    const stream = server.live();
    stream.handlers.onSnapshot(run, ["a"]);
    stream.handlers.onLine("b");
    // The connection blips; the browser reconnects and the server replays.
    stream.handlers.onError(false);
    stream.handlers.onSnapshot(run, ["a", "b", "c"]);
    expect(store.getSnapshot().log).toEqual(["a", "b", "c"]);
    expect(store.getSnapshot().lost).toBe(false);
  });

  it("follows the action already in flight when a start is refused", async () => {
    const server = fakeServer();
    const other = runInfo({ id: 7, action: "create-icm" });
    server.state.busyWith = other;
    const store = createRunStore(server.backend);

    const failure = await store.start({ kind: "devnet", action: "stop" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RunBusyError);
    expect((failure as RunBusyError).run).toEqual(other);
    expect((failure as RunBusyError).message).toBe("another action is running");

    // This tab now shows the other tab's action, live.
    expect(store.getSnapshot().run).toEqual(other);
    expect(server.open()).toBe(1);
    server.live().handlers.onSnapshot(other, ["from the other tab"]);
    expect(store.getSnapshot().log).toEqual(["from the other tab"]);

    // A second refused click does not open a second stream.
    await store.start({ kind: "devnet", action: "stop" }).catch(() => {});
    expect(server.streams).toHaveLength(1);
  });

  it("has no run to follow when the action in the way belongs to another Studio process", async () => {
    const server = fakeServer();
    const reason =
      "Another action (devnet start) is still running in another Studio process (pid 4242) — wait for it to finish, then retry.";
    const backend: RunBackend = {
      ...server.backend,
      startRun: async () => ({ started: false, run: null, error: reason }),
    };
    const store = createRunStore(backend);

    const failure = await store.start({ kind: "devnet", action: "stop" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RunBusyError);
    expect((failure as RunBusyError).run).toBeNull();
    expect((failure as RunBusyError).message).toBe(reason);
    // Nothing of this server's to show, and no stream to open.
    expect(store.getSnapshot()).toEqual({ run: null, log: [], lost: false });
    expect(server.streams).toHaveLength(0);
  });

  it("propagates a rejected start and leaves the view alone", async () => {
    const server = fakeServer();
    const backend: RunBackend = {
      ...server.backend,
      startRun: async () => {
        throw new Error("invalid L1");
      },
    };
    const store = createRunStore(backend);
    await expect(store.start({ kind: "devnet", action: "create-l1" })).rejects.toThrow(
      "invalid L1",
    );
    expect(store.getSnapshot()).toEqual({ run: null, log: [], lost: false });
    expect(server.streams).toHaveLength(0);
  });

  it("marks the run lost when the connection is gone for good, and recovers by polling", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const ended: RunInfo[] = [];
    store.onFinished((run) => ended.push(run));
    const run = await store.start({ kind: "devnet", action: "create-icm" });
    server.live().handlers.onSnapshot(run, ["working"]);

    server.live().handlers.onError(true);
    expect(store.getSnapshot()).toMatchObject({ lost: true, run: { status: "running" } });
    expect(server.open()).toBe(0);
    expect(ended).toEqual([]);

    // Studio is still there and the action went on: the next poll picks it up.
    await store.sync();
    expect(server.open()).toBe(1);
    server.live().handlers.onSnapshot(run, ["working", "still working"]);
    expect(store.getSnapshot()).toMatchObject({ lost: false, log: ["working", "still working"] });

    server.live().handlers.onDone(finished());
    expect(ended).toHaveLength(1);
  });

  it("tolerates a few reconnect attempts before giving up", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    await store.start({ kind: "devnet", action: "create-icm" });
    const stream = server.live();
    for (let i = 0; i < 5; i++) stream.handlers.onError(false);
    expect(store.getSnapshot().lost).toBe(false);
    expect(stream.closed).toBe(false);
    stream.handlers.onError(false);
    expect(store.getSnapshot().lost).toBe(true);
    expect(stream.closed).toBe(true);
  });

  it("keeps showing a lost run while the server cannot be reached or has forgotten it", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    await store.start({ kind: "devnet", action: "create-icm" });
    server.live().handlers.onError(true);

    server.state.unreachable = true;
    await store.sync();
    expect(store.getSnapshot()).toMatchObject({ lost: true, run: { status: "running" } });

    // Studio came back (restarted) and knows nothing of the run.
    server.state.unreachable = false;
    server.state.run = null;
    await store.sync();
    expect(store.getSnapshot()).toMatchObject({ lost: true, run: { status: "running" } });
    expect(server.open()).toBe(0);
  });

  it("drops a finished run that another tab dismissed", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const run = await store.start({ kind: "devnet", action: "stop" });
    server.live().handlers.onSnapshot(run, ["bye"]);
    server.live().handlers.onDone(finished());

    server.state.run = null;
    await store.sync();
    expect(store.getSnapshot()).toEqual({ run: null, log: [], lost: false });
  });

  it("dismiss forgets the run here and on the server", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const run = await store.start({ kind: "devnet", action: "stop" });
    server.live().handlers.onSnapshot(run, ["bye"]);
    server.live().handlers.onDone(finished());

    await store.dismiss();
    expect(server.state.dismissals).toBe(1);
    expect(store.getSnapshot()).toEqual({ run: null, log: [], lost: false });
  });

  it("keeps the run when the server refuses to dismiss it", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const run = await store.start({ kind: "devnet", action: "create-icm" });
    server.live().handlers.onSnapshot(run, ["working"]);
    server.state.dismissFails = true;
    await expect(store.dismiss()).rejects.toThrow("still running");
    expect(store.getSnapshot()).toMatchObject({ run: { status: "running" }, log: ["working"] });
    expect(server.open()).toBe(1);
  });

  it("cancel asks the server and waits for the stream to report the end", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const ended: RunInfo[] = [];
    store.onFinished((run) => ended.push(run));
    await store.start({ kind: "devnet", action: "create-icm" });

    await store.cancel();
    expect(server.state.cancels).toBe(1);
    expect(store.getSnapshot().run?.status).toBe("running");

    server.live().handlers.onLine("■ cancelled");
    server.live().handlers.onDone(finished({ cancelled: true, exitCode: 143 }));
    expect(ended[0]).toMatchObject({ cancelled: true });
  });

  it("ignores events from a connection it has already replaced", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const first = await store.start({ kind: "devnet", action: "start" });
    const old = server.live();
    old.handlers.onSnapshot(first, ["first run"]);
    old.handlers.onDone(finished());

    const second = await store.start({ kind: "devnet", action: "stop" });
    server.live().handlers.onSnapshot(second, ["second run"]);
    // Late events from the first connection must not leak into the second run.
    old.handlers.onLine("stale line");
    old.handlers.onDone(finished({ exitCode: 9 }));
    expect(store.getSnapshot()).toMatchObject({
      run: { id: 2, status: "running" },
      log: ["second run"],
    });
  });

  it("does not poll while it is following a run", async () => {
    const server = fakeServer();
    let fetches = 0;
    const backend: RunBackend = {
      ...server.backend,
      fetchRun: async () => {
        fetches++;
        return server.state.run;
      },
    };
    const store = createRunStore(backend);
    await store.start({ kind: "devnet", action: "create-icm" });
    await store.sync();
    await store.sync();
    expect(fetches).toBe(0);
    expect(server.streams).toHaveLength(1);
  });

  it("stop() only stops watching, and sync() resumes", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const run = await store.start({ kind: "devnet", action: "create-icm" });
    server.live().handlers.onSnapshot(run, ["working"]);

    store.stop();
    expect(server.open()).toBe(0);
    expect(server.state.cancels).toBe(0);
    expect(store.getSnapshot().run?.status).toBe("running");

    await store.sync();
    expect(server.open()).toBe(1);
  });

  it("keeps only the tail of a very long log", async () => {
    const server = fakeServer();
    const store = createRunStore(server.backend);
    const run = await store.start({ kind: "fuji", action: "deploy", name: "myfujil1" });
    const many = Array.from({ length: MAX_LOG_LINES + 10 }, (_, i) => `line ${i}`);
    server.live().handlers.onSnapshot(run, many);
    expect(store.getSnapshot().log).toHaveLength(MAX_LOG_LINES);
    expect(store.getSnapshot().log[0]).toBe("line 10");
    server.live().handlers.onLine("one more");
    expect(store.getSnapshot().log).toHaveLength(MAX_LOG_LINES);
    expect(store.getSnapshot().log.at(-1)).toBe("one more");
    expect(store.getSnapshot().log[0]).toBe("line 11");
  });
});
