/**
 * The Studio's local server. Bound to 127.0.0.1 only, gated by a per-session
 * token, and it validates the Host header — so a page on another origin (or a
 * DNS-rebinding attempt) can't drive it. This is a tool the developer launches
 * themselves; it is never meant to be reachable from the network.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddressData } from "./dataapi.js";
import {
  getDevnetStatus,
  isDevnetAction,
  isValidL1Params,
  type L1Params,
  runDevnetAction,
} from "./devnet.js";
import { InputError } from "./errors.js";
import {
  ensureFujiKey,
  getFujiKeyBalance,
  getFujiL1,
  isFujiAction,
  prepareFujiAction,
} from "./fuji.js";
import { deployMessengers, getIcmState, sendIcmMessage } from "./icm.js";
import { getInventory } from "./inventory.js";
import { busyMessage } from "./lock.js";
import { createRunManager, type RunManager, type StartResult } from "./runs.js";
import { runSteps } from "./steps.js";

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** A failure with a specific HTTP status. Anything else that throws is a 500. */
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The Host header without its port, lower-cased ("[::1]:5173" -> "[::1]"). */
function hostOf(req: IncomingMessage): string {
  return (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
}

/**
 * Parse the request target. Only origin-form ("/path?query") is accepted. A
 * target that starts with "//" (or "/\") is refused rather than resolved: the
 * URL parser reads that as a host — "//" alone makes it throw — and no page
 * Studio serves ever requests one.
 */
export function parseTarget(target: string | undefined): URL | null {
  if (!target || !/^\/(?![/\\])/.test(target)) return null;
  try {
    return new URL(`http://localhost${target}`);
  } catch {
    return null;
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      // Past the limit the rest is discarded unread; the 413 closes the connection.
      if (tooLarge) return;
      data += c.toString();
      if (data.length > 100_000) {
        tooLarge = true;
        data = "";
        reject(new HttpError(413, "body too large"));
      }
    });
    req.on("end", () => {
      let parsed: unknown;
      try {
        parsed = data ? JSON.parse(data) : {};
      } catch {
        reject(new HttpError(400, "invalid JSON"));
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        reject(new HttpError(400, "the request body must be a JSON object"));
        return;
      }
      resolveBody(parsed as Record<string, unknown>);
    });
    req.on("error", reject);
  });
}

/** A body field as a string — anything that is not a string counts as missing. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

/** Start a Server-Sent Events response and return its `send`. */
function openEventStream(res: ServerResponse): (event: string, data: unknown) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  // A comment line now and then, so a quiet stretch of a long action (a Fuji
  // node syncing) never looks like a dead connection.
  const beat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
  }, 25_000);
  beat.unref();
  res.on("close", () => clearInterval(beat));
  return (event, data) => {
    // The client may be gone, or the stream already ended: never write then.
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Constant-time comparison of a caller-supplied token against the session
 * token, so a timing side-channel can't recover it byte by byte. (audit A19)
 */
export function safeTokenEqual(provided: string | string[] | undefined, token: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve a request path inside webDir, or null if it escapes (traversal). */
export function safeFile(webDir: string, pathname: string): string | null {
  const full = resolve(webDir, `.${pathname}`);
  if (full !== webDir && !full.startsWith(webDir + sep)) return null;
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

/**
 * Validate a "start an action" request and hand it to the run manager. Every
 * value that can reach an avalanche-cli argument is whitelist-validated here
 * (and again where the command is built) — an unacceptable request throws
 * InputError and nothing is spawned.
 */
function startRun(runs: RunManager, body: Record<string, unknown>): StartResult {
  const kind = str(body.kind);
  const action = str(body.action);

  if (kind === "devnet") {
    if (!isDevnetAction(action)) throw new InputError("unknown action");
    let l1: L1Params | undefined;
    if (action === "create-l1") {
      // The L1 native-token symbol travels as `symbol`, never `token`: `token`
      // is the session-auth query param, and the two once collided.
      const candidate = {
        name: str(body.name),
        chainId: str(body.chainId),
        token: str(body.symbol),
      };
      if (!isValidL1Params(candidate)) {
        throw new InputError(
          "invalid L1: name [a-z][a-z0-9]{1,31}, chainId 1–4294967295, token [A-Z][A-Z0-9]{0,7}",
        );
      }
      l1 = candidate;
    }
    return runs.start(
      {
        kind,
        action,
        params: l1 ? { name: l1.name, chainId: l1.chainId, symbol: l1.token } : undefined,
      },
      (onLine, onDone) => runDevnetAction(action, onLine, onDone, l1),
    );
  }

  if (kind === "fuji") {
    if (!isFujiAction(action)) throw new InputError("unknown action");
    const prepared = prepareFujiAction(action, {
      name: str(body.name),
      chainId: str(body.chainId) || undefined,
      token: str(body.symbol) || undefined,
      amount: str(body.amount) || undefined,
    });
    if ("error" in prepared) throw new InputError(prepared.error);
    return runs.start({ kind, action, params: prepared.params }, (onLine, onDone) =>
      runSteps(prepared.steps, onLine, onDone),
    );
  }

  throw new InputError("unknown action kind");
}

export interface StudioServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: {
  port?: number;
  cwd: string;
  /** Serve the UI from here instead of the bundled build (used by tests). */
  webDir?: string;
}): Promise<StudioServer> {
  const token = randomBytes(24).toString("hex");
  const webDir = opts.webDir
    ? resolve(opts.webDir)
    : fileURLToPath(new URL("./web", import.meta.url));
  const runs = createRunManager();

  // The built SPA shell; the token is injected so only a page served by this
  // server (same-origin) can read it and call the API.
  const indexHtml = readFileSync(join(webDir, "index.html"), "utf8").replace(
    "</head>",
    `<script>window.__AVAKIT_STUDIO__=${JSON.stringify({ token })}</script></head>`,
  );
  const serveIndex = (res: ServerResponse) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // The dashboard is never meant to be embedded. Refusing to be framed
      // keeps another page from overlaying it and steering a click into an
      // action (clickjacking).
      "content-security-policy": "frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
    });
    res.end(indexHtml);
  };

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const { pathname } = url;
    const method = req.method ?? "GET";

    if (pathname === "/api/health") {
      sendJson(res, 200, { ok: true, name: "avakit-studio" });
      return;
    }
    if (pathname === "/api/env") {
      sendJson(res, 200, await getInventory(opts.cwd));
      return;
    }
    if (pathname === "/api/devnet/status") {
      sendJson(res, 200, await getDevnetStatus());
      return;
    }

    // --- avalanche-cli actions: one at a time, owned by the server -------------
    // A run is started with a POST and followed over a separate event stream,
    // so it does not depend on the connection (or the tab) that started it.
    if (pathname === "/api/run" && method === "GET") {
      sendJson(res, 200, { run: runs.current() });
      return;
    }
    if (pathname === "/api/run" && method === "POST") {
      const result = startRun(runs, await readJsonBody(req));
      if (!result.started) {
        // Refused by this server's own run (`run`), or by one that belongs to
        // another Studio process — the MCP face, a second dashboard (`holder`).
        sendJson(
          res,
          409,
          result.run
            ? {
                error: busyMessage({ action: `${result.run.kind} ${result.run.action}` }, true),
                run: result.run,
              }
            : { error: busyMessage(result.holder), run: null, holder: result.holder },
        );
        return;
      }
      sendJson(res, 200, { run: result.run });
      return;
    }
    if (pathname === "/api/run/cancel" && method === "POST") {
      sendJson(res, 200, { run: runs.cancel() });
      return;
    }
    if (pathname === "/api/run/dismiss" && method === "POST") {
      if (!runs.dismiss()) throw new HttpError(409, "an action is still running");
      sendJson(res, 200, { run: null });
      return;
    }
    // The current run's log so far, then live lines (Server-Sent Events).
    // Closing this stream only stops the watching — never the action.
    if (pathname === "/api/run/stream" && method === "GET") {
      if (!runs.current()) throw new HttpError(404, "no action has run yet");
      const send = openEventStream(res);
      const attachment = runs.attach({
        onLine: (line) => send("line", { line }),
        onDone: (run) => {
          send("done", { run });
          res.end();
        },
      });
      if (!attachment) {
        res.end();
        return;
      }
      send("snapshot", { run: attachment.run, log: attachment.log });
      if (attachment.run.status === "done") {
        send("done", { run: attachment.run });
        res.end();
        return;
      }
      res.on("close", attachment.detach);
      return;
    }

    if (pathname === "/api/fuji/key" && method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await ensureFujiKey(str(body.name)));
      return;
    }
    if (pathname === "/api/fuji/balance") {
      sendJson(res, 200, await getFujiKeyBalance(url.searchParams.get("name") ?? ""));
      return;
    }
    if (pathname === "/api/fuji/l1") {
      sendJson(res, 200, await getFujiL1(url.searchParams.get("name") ?? ""));
      return;
    }
    if (pathname === "/api/icm/state") {
      sendJson(res, 200, await getIcmState());
      return;
    }
    if (pathname === "/api/icm/deploy" && method === "POST") {
      sendJson(res, 200, await deployMessengers());
      return;
    }
    if (pathname === "/api/icm/send" && method === "POST") {
      const body = await readJsonBody(req);
      // sendIcmMessage validates the chains and the message itself (InputError).
      sendJson(res, 200, await sendIcmMessage(str(body.from), str(body.to), str(body.message)));
      return;
    }
    if (pathname === "/api/data") {
      const address = url.searchParams.get("address") ?? "";
      const chainId = Number(url.searchParams.get("chainId") ?? "43113");
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, "invalid address");
      if (chainId !== 43113 && chainId !== 43114) throw new HttpError(400, "unsupported chain");
      sendJson(res, 200, await getAddressData(address, chainId));
      return;
    }
    throw new HttpError(404, "not found");
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!ALLOWED_HOSTS.has(hostOf(req))) throw new HttpError(403, "forbidden");

    const url = parseTarget(req.url);
    if (!url) throw new HttpError(400, "bad request");
    const { pathname } = url;

    // API surface — token required (header, or query param for EventSource,
    // which cannot set headers). Both are same-origin only.
    if (pathname.startsWith("/api/")) {
      const provided = req.headers["x-studio-token"] ?? url.searchParams.get("token") ?? undefined;
      if (!safeTokenEqual(provided, token)) throw new HttpError(401, "unauthorized");
      await api(req, res, url);
      return;
    }

    // Static assets (Vite build), then SPA fallback to the injected shell.
    if (pathname !== "/" && pathname !== "/index.html") {
      const file = safeFile(webDir, pathname);
      if (file) {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
        });
        res.end(readFileSync(file));
        return;
      }
    }
    serveIndex(res);
  }

  // Nothing a request does may take the process down: every failure, sync or
  // async, ends up here and becomes a response (or, mid-stream, a closed one).
  const server = createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = e instanceof HttpError ? e.status : e instanceof InputError ? 400 : 500;
      // An over-long body is not read to its end, so the connection can't be reused.
      if (status === 413) res.setHeader("connection", "close");
      sendJson(res, status, { error: e instanceof Error ? e.message : String(e) });
    });
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.on("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : (opts.port ?? 0));
    });
  });

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        // Open event streams would otherwise keep close() waiting forever.
        server.closeAllConnections();
      }),
  };
}
