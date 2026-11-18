import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import http, { type IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunInfo } from "./runs.js";
import { parseTarget, type StudioServer, safeFile, safeTokenEqual, startServer } from "./server.js";
import { createSandbox, type Sandbox } from "./testing/sandbox.js";

describe("safeTokenEqual (A19)", () => {
  it("matches only the exact token", () => {
    expect(safeTokenEqual("abc123def", "abc123def")).toBe(true);
  });

  it("rejects wrong, different-length, array, and undefined inputs", () => {
    expect(safeTokenEqual("abc123deg", "abc123def")).toBe(false);
    expect(safeTokenEqual("abc", "abc123def")).toBe(false);
    expect(safeTokenEqual(["abc123def"], "abc123def")).toBe(false);
    expect(safeTokenEqual(undefined, "abc123def")).toBe(false);
  });
});

describe("parseTarget", () => {
  it("accepts origin-form targets", () => {
    expect(parseTarget("/")?.pathname).toBe("/");
    expect(parseTarget("/api/data?address=0x1&chainId=43113")?.searchParams.get("chainId")).toBe(
      "43113",
    );
    // Dot segments are resolved by the parser, never handed on.
    expect(parseTarget("/assets/../../etc/passwd")?.pathname).toBe("/etc/passwd");
  });

  it("refuses everything else instead of throwing", () => {
    for (const bad of [
      undefined,
      "",
      "//",
      "//evil.example/api/health",
      "/\\evil.example/api/health",
      "http://evil.example/api/health",
      "*",
      "api/health",
    ]) {
      expect(parseTarget(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

// --- request-level tests ----------------------------------------------------

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  json: () => Record<string, unknown>;
}

let sandbox: Sandbox;
let server: StudioServer;
let token: string;
let webDir: string;

/** One raw HTTP request: the path and the Host header go out exactly as given. */
function request(
  target: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** The Host header to send; `null` sends none at all. */
    host?: string | null;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method: opts.method ?? "GET",
        path: target,
        agent: false,
        setHost: false,
        headers: {
          ...(opts.host === null ? {} : { host: opts.host ?? `127.0.0.1:${server.port}` }),
          ...opts.headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => {
          body += c.toString();
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body) as Record<string, unknown>,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

/** An authenticated API call. */
function api(target: string, opts: { method?: string; body?: unknown } = {}): Promise<Reply> {
  return request(target, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: { "x-studio-token": token, "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  ok: (value: T) => boolean,
  ms = 20_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting; last: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const currentRun = async () => (await api("/api/run")).json().run as RunInfo | null;
const runDone = () => waitFor(currentRun, (run) => run?.status === "done");

interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Follow /api/run/stream. `close()` drops the connection like a closed tab would. */
function openStream(): {
  events: StreamEvent[];
  status: () => number | null;
  ended: () => boolean;
  /** Snapshot log plus every line received since. */
  lines: () => string[];
  close: () => void;
} {
  const events: StreamEvent[] = [];
  let status: number | null = null;
  let ended = false;
  let buffer = "";
  const req = http.get(
    {
      host: "127.0.0.1",
      port: server.port,
      path: `/api/run/stream?token=${token}`,
      agent: false,
      headers: { host: `127.0.0.1:${server.port}` },
    },
    (res) => {
      status = res.statusCode ?? 0;
      res.on("data", (c: Buffer) => {
        buffer += c.toString();
        let cut = buffer.indexOf("\n\n");
        while (cut !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
          cut = buffer.indexOf("\n\n");
        }
      });
      res.on("end", () => {
        ended = true;
      });
      res.on("error", () => {
        ended = true;
      });
    },
  );
  req.on("error", () => {
    ended = true;
  });
  return {
    events,
    status: () => status,
    ended: () => ended,
    lines: () =>
      events.flatMap((e) =>
        e.event === "snapshot"
          ? (e.data.log as string[])
          : e.event === "line"
            ? [e.data.line as string]
            : [],
      ),
    close: () => req.destroy(),
  };
}

beforeEach(async () => {
  sandbox = createSandbox();
  // A minimal stand-in for the built UI, with a secret file NEXT to it.
  webDir = path.join(sandbox.home, "web");
  mkdirSync(path.join(webDir, "assets"), { recursive: true });
  writeFileSync(
    path.join(webDir, "index.html"),
    "<html><head></head><body>studio shell</body></html>",
  );
  writeFileSync(path.join(webDir, "assets", "app.js"), "console.log('studio')");
  writeFileSync(path.join(sandbox.home, "secret.txt"), "TOP-SECRET");

  server = await startServer({ cwd: sandbox.home, webDir });
  const shell = await request("/");
  token = /window\.__AVAKIT_STUDIO__=\{"token":"([0-9a-f]+)"\}/.exec(shell.body)?.[1] ?? "";
});

afterEach(async () => {
  await server.close();
  sandbox.dispose();
});

describe("static files", () => {
  it("serves the shell with the session token and refuses to be framed", async () => {
    const shell = await request("/");
    expect(shell.status).toBe(200);
    expect(shell.body).toContain("studio shell");
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(shell.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(shell.headers["cache-control"]).toBe("no-store");
    expect(shell.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(shell.headers["x-frame-options"]).toBe("DENY");
  });

  it("serves built assets with their content type and falls back to the shell", async () => {
    const asset = await request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.body).toBe("console.log('studio')");
    expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");

    const unknown = await request("/some/client/route");
    expect(unknown.status).toBe(200);
    expect(unknown.body).toContain("studio shell");
  });

  it("never serves a file outside the UI directory", async () => {
    for (const target of [
      "/../secret.txt",
      "/assets/../../secret.txt",
      "/%2e%2e/secret.txt",
      "/..%2fsecret.txt",
      "/..%5csecret.txt",
      "/assets/..%2f..%2fsecret.txt",
    ]) {
      const reply = await request(target);
      expect(reply.body, target).not.toContain("TOP-SECRET");
    }
    // The guard itself, given a path the URL parser would never let through.
    expect(safeFile(webDir, "/../secret.txt")).toBeNull();
    expect(safeFile(webDir, "/assets/../../secret.txt")).toBeNull();
    expect(safeFile(webDir, "/assets")).toBeNull(); // a directory is not a file
    expect(safeFile(webDir, "/assets/app.js")).toBe(path.join(webDir, "assets", "app.js"));
  });
});

describe("Host and token gates", () => {
  it("refuses any Host that is not this machine", async () => {
    for (const host of [
      "evil.example",
      `evil.example:${server.port}`,
      "127.0.0.1.evil.example",
      "localhost.evil.example",
      `127.0.0.1:${server.port}:80`,
    ]) {
      const reply = await request("/", { host });
      expect(reply.status, host).toBe(403);
      expect(reply.json()).toEqual({ error: "forbidden" });
    }
    // No Host header at all is refused too (by Node's own HTTP/1.1 check, or by ours).
    const none = await request("/", { host: null });
    expect([400, 403]).toContain(none.status);
    expect(none.body).not.toContain("__AVAKIT_STUDIO__");
    // …even with a valid token: the Host check comes first.
    const withToken = await request("/api/health", {
      host: "evil.example",
      headers: { "x-studio-token": token },
    });
    expect(withToken.status).toBe(403);
  });

  it("accepts the loopback names, with or without a port", async () => {
    for (const host of [
      `127.0.0.1:${server.port}`,
      `localhost:${server.port}`,
      "localhost",
      `LOCALHOST:${server.port}`,
      `[::1]:${server.port}`,
    ]) {
      expect((await request("/", { host })).status, host).toBe(200);
    }
  });

  it("requires the session token on every API route", async () => {
    const paths = ["/api/health", "/api/env", "/api/run", "/api/icm/state", "/api/nope"];
    for (const p of paths) {
      expect((await request(p)).status, p).toBe(401);
      const wrong = await request(p, { headers: { "x-studio-token": "0".repeat(48) } });
      expect(wrong.status, p).toBe(401);
    }
    const short = await request("/api/health", { headers: { "x-studio-token": token.slice(1) } });
    expect(short.status).toBe(401);
    // A POST without it never reaches its handler.
    sandbox.stub("avalanche", '() => ({ out: "ran\\n" })');
    const start = await request("/api/run", {
      method: "POST",
      body: JSON.stringify({ kind: "devnet", action: "stop" }),
    });
    expect(start.status).toBe(401);
    expect(sandbox.calls("avalanche")).toEqual([]);
  });

  it("accepts the token as a header, or as a query parameter for event streams", async () => {
    expect((await api("/api/health")).json()).toEqual({ ok: true, name: "avakit-studio" });
    expect((await request(`/api/health?token=${token}`)).status).toBe(200);
  });
});

describe("malformed requests", () => {
  it("answers 400 to a request target the URL parser rejects, and stays up", async () => {
    // "//" used to throw inside the handler and take the whole process down.
    for (const target of ["//", "//evil.example/api/health", "http://evil.example/api/health"]) {
      const reply = await request(target, { headers: { "x-studio-token": token } });
      expect(reply.status, target).toBe(400);
      expect(reply.json()).toEqual({ error: "bad request" });
    }
    expect((await api("/api/health")).status).toBe(200);
  });

  it("answers 404 to an unknown API route", async () => {
    const reply = await api("/api/does-not-exist");
    expect(reply.status).toBe(404);
    expect(reply.json()).toEqual({ error: "not found" });
  });

  it("answers 400 to a body that is not a JSON object, and 413 to a huge one", async () => {
    const post = (body: string) =>
      request("/api/icm/send", {
        method: "POST",
        headers: { "x-studio-token": token },
        body,
      });
    expect((await post("{not json")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect((await post("[1,2]")).status).toBe(400);
    expect((await post(JSON.stringify({ pad: "x".repeat(100_100) }))).status).toBe(413);
    expect((await api("/api/health")).status).toBe(200);
  });

  it("validates the data lookup before calling out", async () => {
    expect((await api("/api/data?address=0x123&chainId=43113")).json()).toEqual({
      error: "invalid address",
    });
    const address = `0x${"ab".repeat(20)}`;
    const reply = await api(`/api/data?address=${address}&chainId=1`);
    expect(reply.status).toBe(400);
    expect(reply.json()).toEqual({ error: "unsupported chain" });
  });

  it("rejects an invalid Fuji key name with 400", async () => {
    sandbox.stub("avalanche", "() => ({})");
    const reply = await api("/api/fuji/key", { body: { name: "../../etc/passwd" } });
    expect(reply.status).toBe(400);
    expect(reply.json()).toEqual({ error: "invalid L1 name" });
    expect(sandbox.calls("avalanche")).toEqual([]);
  });

  it("rejects an invalid Interchain send with 400 and the reason, without running cast", async () => {
    sandbox.fakeCast();
    const send = (body: unknown) => api("/api/icm/send", { body });
    const cases: [unknown, string][] = [
      [{ from: "chain1", to: "chain1", message: "gm" }, "pick two different chains"],
      [{ from: "chain1", to: "chain2" }, "message is empty"],
      [{ from: "chain1", to: "chain2", message: 42 }, "message is empty"],
      [{ from: "chain1", to: "chain2", message: "--help" }, "message cannot start with '-'"],
      [
        { from: "chain1", to: "chain2", message: "x".repeat(300) },
        "message is 300 bytes; the messenger accepts at most 256 (UTF-8)",
      ],
      // 86 characters, but 258 bytes of UTF-8: the limit is in bytes.
      [
        { from: "chain1", to: "chain2", message: "山".repeat(86) },
        "message is 258 bytes; the messenger accepts at most 256 (UTF-8)",
      ],
      [{ from: "chain1", to: "chain2", message: "gm" }, "unknown chain: chain1"],
    ];
    for (const [body, error] of cases) {
      const reply = await send(body);
      expect(reply.status, error).toBe(400);
      expect(reply.json()).toEqual({ error });
    }
    expect(sandbox.calls("cast")).toEqual([]);
  });
});

describe("avalanche-cli actions", () => {
  const go = () => path.join(sandbox.home, "go");
  const marker = () => path.join(sandbox.home, "finished");

  /** An `avalanche` that prints, then waits until the test lets it finish. */
  function slowAvalanche(): void {
    sandbox.stub(
      "avalanche",
      `async () => {
        const fs = await import("node:fs");
        process.stdout.write("step 1\\n");
        while (!fs.existsSync(${JSON.stringify(go())})) await new Promise((r) => setTimeout(r, 20));
        fs.writeFileSync(${JSON.stringify(marker())}, "yes");
        process.stdout.write("finished\\n");
      }`,
    );
  }
  const release = () => writeFileSync(go(), "");

  it("reports no run before anything was started", async () => {
    expect(await currentRun()).toBeNull();
    const stream = await api("/api/run/stream");
    expect(stream.status).toBe(404);
  });

  it("starts an action and reports it", async () => {
    sandbox.stub("avalanche", '() => ({ out: "Network stopped successfully.\\n" })');
    const reply = await api("/api/run", { body: { kind: "devnet", action: "stop" } });
    expect(reply.status).toBe(200);
    expect(reply.json().run).toMatchObject({
      id: 1,
      kind: "devnet",
      action: "stop",
      params: {},
      status: "running",
    });
    expect(await runDone()).toMatchObject({ status: "done", exitCode: 0, cancelled: false });
    expect(sandbox.calls("avalanche")).toEqual([["network", "stop"]]);
  });

  it("refuses a second action while one is running, without spawning it", async () => {
    slowAvalanche();
    expect((await api("/api/run", { body: { kind: "devnet", action: "start" } })).status).toBe(200);

    for (const body of [
      { kind: "devnet", action: "stop" },
      { kind: "devnet", action: "create-icm" },
      { kind: "fuji", action: "transfer", name: "myfujil1", amount: "0.3" },
    ]) {
      const reply = await api("/api/run", { body });
      expect(reply.status).toBe(409);
      expect(reply.json().run).toMatchObject({ id: 1, action: "start", status: "running" });
      expect(reply.json().error).toMatch(/devnet start\) is still running/);
    }
    release();
    await runDone();
    // Exactly one command ever ran.
    expect(sandbox.calls("avalanche")).toEqual([["network", "start"]]);

    // And the lock is free again.
    const next = await api("/api/run", { body: { kind: "devnet", action: "stop" } });
    expect(next.status).toBe(200);
    expect(next.json().run).toMatchObject({ id: 2 });
    await runDone();
  });

  it("rejects an invalid start request with 400 and spawns nothing", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ran\\n" })');
    const cases: [unknown, RegExp][] = [
      [{}, /unknown action kind/],
      [{ kind: "shell", action: "start" }, /unknown action kind/],
      [{ kind: "devnet", action: "network clean" }, /unknown action/],
      [{ kind: "devnet", action: "create-l1" }, /invalid L1/],
      [
        { kind: "devnet", action: "create-l1", name: "--force", chainId: "9999", symbol: "MYL1" },
        /invalid L1/,
      ],
      [
        { kind: "devnet", action: "create-l1", name: "mychain", chainId: "9999", symbol: "--icm" },
        /invalid L1/,
      ],
      [{ kind: "fuji", action: "wipe", name: "myfujil1" }, /unknown action/],
      [{ kind: "fuji", action: "transfer", name: "myfujil1", amount: "-1" }, /invalid transfer/],
      [{ kind: "fuji", action: "transfer", name: "--key", amount: "1" }, /invalid transfer/],
      [
        { kind: "fuji", action: "deploy", name: "myfujil1", chainId: "77777", symbol: "FUJ" },
        /key not found/,
      ],
    ];
    for (const [body, error] of cases) {
      const reply = await api("/api/run", { body });
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.json().error).toMatch(error);
    }
    expect(sandbox.calls("avalanche")).toEqual([]);
    expect(await currentRun()).toBeNull();
  });

  it("passes a custom L1's validated values to the command, and echoes them", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const reply = await api("/api/run", {
      body: {
        kind: "devnet",
        action: "create-l1",
        name: "mychain",
        chainId: "9999",
        symbol: "MYL1",
      },
    });
    expect(reply.json().run).toMatchObject({
      action: "create-l1",
      params: { name: "mychain", chainId: "9999", symbol: "MYL1" },
    });
    await runDone();
    expect(sandbox.calls("avalanche").map((a) => a.slice(0, 3).join(" "))).toEqual([
      "blockchain create mychain",
      "blockchain deploy mychain",
    ]);
  });

  it("no longer starts anything from a GET", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ran\\n" })');
    for (const target of [
      `/api/devnet/stream?action=stop&token=${token}`,
      `/api/fuji/stream?action=transfer&name=myfujil1&amount=0.3&token=${token}`,
      `/api/run?kind=devnet&action=stop&token=${token}`,
    ]) {
      const reply = await request(target);
      expect([200, 404], target).toContain(reply.status);
    }
    expect(sandbox.calls("avalanche")).toEqual([]);
    expect(await currentRun()).toBeNull();
  });

  it("replays the log to a client that attaches late, then streams to the end", async () => {
    slowAvalanche();
    await api("/api/run", { body: { kind: "devnet", action: "start" } });

    const first = openStream();
    await waitFor(first.lines, (lines) => lines.includes("step 1"));

    // A second tab opening now gets everything printed so far in one snapshot.
    const second = openStream();
    const snapshot = await waitFor(
      () => second.events[0],
      (e) => e !== undefined,
    );
    expect(snapshot?.event).toBe("snapshot");
    expect(snapshot?.data.run).toMatchObject({ id: 1, action: "start", status: "running" });
    expect(snapshot?.data.log).toEqual(["$ avalanche network start", "step 1"]);

    release();
    for (const stream of [first, second]) {
      await waitFor(stream.ended, (ended) => ended);
      expect(stream.status()).toBe(200);
      expect(stream.lines()).toEqual(["$ avalanche network start", "step 1", "finished"]);
      const last = stream.events.at(-1);
      expect(last?.event).toBe("done");
      expect(last?.data.run).toMatchObject({ status: "done", exitCode: 0, cancelled: false });
    }
  });

  it("keeps the action running when the tab that started it goes away", async () => {
    slowAvalanche();
    await api("/api/run", {
      body: { kind: "fuji", action: "transfer", name: "myfujil1", amount: "0.3" },
    });

    // The tab is watching … and is closed (or reloaded) in the middle of it.
    const tab = openStream();
    await waitFor(tab.lines, (lines) => lines.includes("step 1"));
    tab.close();
    await new Promise((r) => setTimeout(r, 150));

    // Still running, and still the only action allowed.
    expect(await currentRun()).toMatchObject({
      kind: "fuji",
      action: "transfer",
      status: "running",
    });
    expect(existsSync(marker())).toBe(false);

    // It is allowed to finish on its own.
    release();
    expect(await runDone()).toMatchObject({ status: "done", exitCode: 0, cancelled: false });
    expect(existsSync(marker())).toBe(true);

    // The reloaded tab re-attaches and finds the whole log, including the end.
    const reloaded = openStream();
    await waitFor(reloaded.ended, (ended) => ended);
    expect(reloaded.lines()).toEqual([
      "$ avalanche key transfer --key myfujil1 --fuji --c-chain-sender --p-chain-receiver --amount 0.3",
      "step 1",
      "finished",
    ]);
    expect(reloaded.events.map((e) => e.event)).toEqual(["snapshot", "done"]);
    expect(reloaded.events[0]?.data.run).toMatchObject({
      params: { name: "myfujil1", amount: "0.3" },
    });
  });

  it("cancel stops the action and frees the lock", async () => {
    slowAvalanche();
    await api("/api/run", { body: { kind: "devnet", action: "start" } });
    const stream = openStream();
    await waitFor(stream.lines, (lines) => lines.includes("step 1"));

    expect((await api("/api/run/dismiss", { method: "POST" })).status).toBe(409);
    const cancel = await api("/api/run/cancel", { method: "POST" });
    expect(cancel.status).toBe(200);

    expect(await runDone()).toMatchObject({ status: "done", cancelled: true, exitCode: 143 });
    await waitFor(stream.ended, (ended) => ended);
    expect(stream.lines().at(-1)).toBe("■ cancelled");
    expect(existsSync(marker())).toBe(false);

    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    expect((await api("/api/run", { body: { kind: "devnet", action: "stop" } })).status).toBe(200);
    await runDone();
  });

  it("forgets a finished run when it is dismissed", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    await api("/api/run", { body: { kind: "devnet", action: "stop" } });
    await runDone();
    const dismissed = await api("/api/run/dismiss", { method: "POST" });
    expect(dismissed.status).toBe(200);
    expect(await currentRun()).toBeNull();
    expect((await api("/api/run/stream")).status).toBe(404);
  });

  it("survives avalanche-cli not being installed", async () => {
    // No stub on PATH: the spawn fails. That used to end the run twice and
    // write to an event stream that had already been closed.
    await api("/api/run", { body: { kind: "devnet", action: "start" } });
    const stream = openStream();
    expect(await runDone()).toMatchObject({ status: "done", exitCode: 1, cancelled: false });
    await waitFor(stream.ended, (ended) => ended);
    expect(stream.lines()).toEqual([
      "$ avalanche network start",
      "error: avalanche is not installed or not on your PATH",
    ]);
    expect(stream.events.filter((e) => e.event === "done")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 100));
    expect((await api("/api/health")).status).toBe(200);
  });
});
