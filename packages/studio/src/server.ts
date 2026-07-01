/**
 * The Studio's local server. Bound to 127.0.0.1 only, gated by a per-session
 * token, and it validates the Host header — so a page on another origin (or a
 * DNS-rebinding attempt) can't drive it. This is a tool the developer launches
 * themselves; it is never meant to be reachable from the network.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { getInventory } from "./inventory.js";

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostOf(req: IncomingMessage): string {
  const raw = req.headers.host ?? "";
  return raw.split(":")[0] ?? "";
}

/** Reject anything not addressed to a loopback host (defends DNS rebinding). */
function isLoopbackHost(req: IncomingMessage): boolean {
  return ALLOWED_HOSTS.has(hostOf(req));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export interface StudioServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: { port?: number; cwd: string }): Promise<StudioServer> {
  const token = randomBytes(24).toString("hex");
  const webDir = fileURLToPath(new URL("./web/", import.meta.url));

  // The single-page shell; the token is injected so only a page served by this
  // server (same-origin) can read it and call the API.
  const indexHtml = readFileSync(new URL("./web/index.html", import.meta.url), "utf8").replace(
    "</head>",
    `<script>window.__AVAKIT_STUDIO__=${JSON.stringify({ token })}</script></head>`,
  );

  const server = createServer(async (req, res) => {
    if (!isLoopbackHost(req)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    // API surface — token required.
    if (pathname.startsWith("/api/")) {
      if (req.headers["x-studio-token"] !== token) {
        sendJson(res, 401, { error: "unauthorized" });
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
        sendJson(res, 404, { error: "not found" });
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // Everything else serves the SPA shell (with the token injected).
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(indexHtml);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    void webDir; // reserved for static assets in later phases
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    // 0 = let the OS pick a free port when no port is requested.
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 0));
    });
  });

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
