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
import { getDevnetStatus, isDevnetAction, isValidL1Params, runDevnetAction } from "./devnet.js";
import {
  ensureFujiKey,
  getFujiKeyBalance,
  getFujiL1,
  isFujiAction,
  runFujiAction,
} from "./fuji.js";
import { deployMessengers, getIcmState, sendIcmMessage } from "./icm.js";
import { getInventory } from "./inventory.js";

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

function hostOf(req: IncomingMessage): string {
  return (req.headers.host ?? "").split(":")[0] ?? "";
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => {
      data += c.toString();
      if (data.length > 100_000) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
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
function safeFile(webDir: string, pathname: string): string | null {
  const full = resolve(webDir, `.${pathname}`);
  if (full !== webDir && !full.startsWith(webDir + sep)) return null;
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

export interface StudioServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: { port?: number; cwd: string }): Promise<StudioServer> {
  const token = randomBytes(24).toString("hex");
  const webDir = fileURLToPath(new URL("./web", import.meta.url));

  // The built SPA shell; the token is injected so only a page served by this
  // server (same-origin) can read it and call the API.
  const indexHtml = readFileSync(join(webDir, "index.html"), "utf8").replace(
    "</head>",
    `<script>window.__AVAKIT_STUDIO__=${JSON.stringify({ token })}</script></head>`,
  );
  const serveIndex = (res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(indexHtml);
  };

  const server = createServer(async (req, res) => {
    if (!ALLOWED_HOSTS.has(hostOf(req))) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    // API surface — token required (header, or query param for EventSource,
    // which cannot set headers). Both are same-origin only.
    if (pathname.startsWith("/api/")) {
      const provided = req.headers["x-studio-token"] ?? url.searchParams.get("token") ?? undefined;
      if (!safeTokenEqual(provided, token)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      // Live action log (Server-Sent Events).
      if (pathname === "/api/devnet/stream") {
        const action = url.searchParams.get("action") ?? "";
        if (!isDevnetAction(action)) {
          sendJson(res, 400, { error: "unknown action" });
          return;
        }
        // create-l1 carries user-chosen name/chainId/token — validated with a
        // strict whitelist before any value can reach the command array.
        let l1Params: { name: string; chainId: string; token: string } | undefined;
        if (action === "create-l1") {
          const candidate = {
            name: url.searchParams.get("name") ?? "",
            chainId: url.searchParams.get("chainId") ?? "",
            // The L1 native-token symbol travels as `symbol`, not `token`, so it
            // never collides with the `token` session-auth query param above.
            token: url.searchParams.get("symbol") ?? "",
          };
          if (!isValidL1Params(candidate)) {
            sendJson(res, 400, {
              error:
                "invalid L1: name [a-z][a-z0-9]{1,31}, chainId 1–4294967295, token [A-Z][A-Z0-9]{0,7}",
            });
            return;
          }
          l1Params = candidate;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        const send = (event: string, data: unknown) =>
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("start", { action });
        const handle = runDevnetAction(
          action,
          (line) => send("line", { line }),
          (exitCode) => {
            send("done", { exitCode });
            res.end();
          },
          l1Params,
        );
        req.on("close", () => handle.cancel());
        return;
      }

      // Fuji L1 wizard live log (transfer C->P, or create+deploy to Fuji).
      if (pathname === "/api/fuji/stream") {
        const action = url.searchParams.get("action") ?? "";
        if (!isFujiAction(action)) {
          sendJson(res, 400, { error: "unknown action" });
          return;
        }
        const p = {
          name: url.searchParams.get("name") ?? "",
          chainId: url.searchParams.get("chainId") ?? undefined,
          // L1 native-token symbol as `symbol` — see the note in /api/devnet/stream;
          // `token` is reserved for the session-auth query param.
          token: url.searchParams.get("symbol") ?? undefined,
          amount: url.searchParams.get("amount") ?? undefined,
        };
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        const send = (event: string, data: unknown) =>
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("start", { action });
        const handle = runFujiAction(
          action,
          p,
          (line) => send("line", { line }),
          (exitCode) => {
            send("done", { exitCode });
            res.end();
          },
        );
        req.on("close", () => handle.cancel());
        return;
      }

      try {
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
        if (pathname === "/api/fuji/key" && req.method === "POST") {
          const body = await readJsonBody(req);
          const name = String(body.name ?? "");
          try {
            sendJson(res, 200, await ensureFujiKey(name));
          } catch (e) {
            sendJson(res, 400, { error: e instanceof Error ? e.message : "invalid" });
          }
          return;
        }
        if (pathname === "/api/fuji/balance") {
          const name = url.searchParams.get("name") ?? "";
          sendJson(res, 200, await getFujiKeyBalance(name));
          return;
        }
        if (pathname === "/api/fuji/l1") {
          const name = url.searchParams.get("name") ?? "";
          sendJson(res, 200, await getFujiL1(name));
          return;
        }
        if (pathname === "/api/icm/state") {
          sendJson(res, 200, await getIcmState());
          return;
        }
        if (pathname === "/api/icm/deploy" && req.method === "POST") {
          sendJson(res, 200, await deployMessengers());
          return;
        }
        if (pathname === "/api/icm/send" && req.method === "POST") {
          const body = await readJsonBody(req);
          const from = String(body.from ?? "");
          const to = String(body.to ?? "");
          const message = String(body.message ?? "");
          if (!from || !to || from === to) {
            sendJson(res, 400, { error: "pick two different chains" });
            return;
          }
          if (message.length < 1 || message.length > 200) {
            sendJson(res, 400, { error: "message must be 1–200 characters" });
            return;
          }
          if (message.startsWith("-")) {
            sendJson(res, 400, { error: "message cannot start with '-'" });
            return;
          }
          sendJson(res, 200, await sendIcmMessage(from, to, message));
          return;
        }
        if (pathname === "/api/data") {
          const address = url.searchParams.get("address") ?? "";
          const chainId = Number(url.searchParams.get("chainId") ?? "43113");
          if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
            sendJson(res, 400, { error: "invalid address" });
            return;
          }
          if (chainId !== 43113 && chainId !== 43114) {
            sendJson(res, 400, { error: "unsupported chain" });
            return;
          }
          sendJson(res, 200, await getAddressData(address, chainId));
          return;
        }
        sendJson(res, 404, { error: "not found" });
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // Static assets (Vite build), then SPA fallback to the injected shell.
    if (pathname !== "/" && pathname !== "/index.html") {
      const file = safeFile(webDir, pathname);
      if (file) {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        });
        res.end(readFileSync(file));
        return;
      }
    }
    serveIndex(res);
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
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
