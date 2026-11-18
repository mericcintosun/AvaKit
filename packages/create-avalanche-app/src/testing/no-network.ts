/**
 * Test setup (see vitest.config.ts): no test in this package may talk to the
 * network.
 *
 * The CLI reports anonymous usage to a public collector, and what that collector
 * counts is published. A test that reached it would put robot runs into a number
 * that is meant to be people. So every HTTP(S) request to anything but this
 * machine is refused here, and the test that made it fails — even if the code
 * under test swallowed the refusal, as telemetry does on purpose.
 *
 * Covered: `node:http` and `node:https` (`request` and `get`, however they are
 * imported) and the global `fetch`. Raw sockets are not; nothing here opens one.
 *
 * Tests that need a server start one on 127.0.0.1; those requests pass.
 */

import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { afterAll, afterEach, expect } from "vitest";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// On globalThis, so the list and the guard survive `vi.resetModules()`.
const KEY = Symbol.for("create-avalanche-app.tests.blocked-requests");
const store = globalThis as { [KEY]?: string[] };
if (!store[KEY]) store[KEY] = [];
const blocked: string[] = store[KEY];

/** Throw, and remember it, unless every one of `hosts` is this machine. */
function refuseUnlessLocal(hosts: readonly string[]): void {
  const outside = hosts.find((host) => !LOOPBACK.has(host));
  if (outside === undefined) return;
  blocked.push(outside);
  throw new Error(`Tests must not use the network: blocked a request to "${outside}".`);
}

/**
 * Every host an `http.request(urlOrOptions, options?)` call names.
 *
 * Node merges the URL into the options and then prefers `hostname` to `host`,
 * so which of them it would connect to depends on the combination: a `host`
 * option does not override the URL, a `hostname` option does. Rather than
 * repeat that rule here and be wrong about one case, a call is let through
 * only when all the hosts it names are local.
 */
function hostsOf(input: unknown, options: unknown): string[] {
  const hosts: string[] = [];
  let given = input;
  if (typeof input === "string" || input instanceof URL) {
    hosts.push(new URL(input).hostname);
    given = options;
  }
  if (typeof given === "object" && given !== null) {
    const { hostname, host } = given as { hostname?: unknown; host?: unknown };
    for (const value of [hostname, host]) {
      if (typeof value === "string" && value !== "") hosts.push(value);
    }
  }
  // Node's own default when no host is given.
  return hosts.length > 0 ? hosts : ["localhost"];
}

for (const client of [http, https]) {
  for (const method of ["request", "get"] as const) {
    const original = client[method] as ((...args: unknown[]) => unknown) & { [KEY]?: true };
    if (original[KEY]) continue; // already guarded
    const guarded = function (this: unknown, ...args: unknown[]) {
      refuseUnlessLocal(hostsOf(args[0], args[1]));
      return Reflect.apply(original, this, args);
    } as typeof original;
    guarded[KEY] = true;
    (client as unknown as Record<string, unknown>)[method] = guarded;
  }
}
// `import { request } from "node:https"` binds to a copy of the export taken
// when the module was first imported; this brings those copies up to date.
syncBuiltinESMExports();

const originalFetch = globalThis.fetch as typeof fetch & { [KEY]?: true };
if (!originalFetch[KEY]) {
  // Async, so a refusal is a rejected promise, as a failed fetch would be.
  const guarded = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    // Only http(s) goes anywhere. A `data:` or `blob:` URL is read from memory —
    // Ink's layout engine loads its WebAssembly through one.
    if (url.protocol === "http:" || url.protocol === "https:") refuseUnlessLocal([url.hostname]);
    return originalFetch(input, init);
  }) as typeof originalFetch;
  guarded[KEY] = true;
  globalThis.fetch = guarded;
}

/** The hosts refused since the last call. Reading the list empties it. */
export function takeBlockedRequests(): string[] {
  return blocked.splice(0);
}

function expectNoBlockedRequests(): void {
  expect(
    takeBlockedRequests(),
    "this test tried to reach the network; point it at a server on 127.0.0.1 instead",
  ).toEqual([]);
}

afterEach(expectNoBlockedRequests);
// A request made outside a test — in a hook, or after the last one — still fails the file.
afterAll(expectNoBlockedRequests);
