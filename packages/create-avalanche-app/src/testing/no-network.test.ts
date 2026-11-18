import http, { get as httpGet } from "node:http";
import https, { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { takeBlockedRequests } from "./no-network.js";

// A name that can never resolve (RFC 2606): nothing in this file could reach a
// real host even if the guard were missing.
const OUTSIDE = "collector.example.invalid";

describe("the no-network guard", () => {
  let server: http.Server;
  let local: string;

  beforeAll(async () => {
    server = http.createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    local = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("refuses every HTTP and HTTPS request that leaves this machine", () => {
    const attempts = [
      () => https.request(`https://${OUTSIDE}/e`),
      () => https.request(new URL(`https://${OUTSIDE}/e`), { method: "POST" }),
      () => http.request({ hostname: OUTSIDE, path: "/e" }),
      () => http.get(`http://${OUTSIDE}/e`),
      () => https.get({ host: OUTSIDE }),
      // Imported by name rather than through the module object.
      () => httpsRequest(`https://${OUTSIDE}/e`),
      () => httpGet(`http://${OUTSIDE}/e`),
      // A local URL is no cover for another host in the options …
      () => http.request("http://127.0.0.1/e", { hostname: OUTSIDE }),
      () => http.request("http://127.0.0.1/e", { host: OUTSIDE }),
      // … nor a local host in the options for another one in the URL: Node
      // would connect to the URL's host here, because `host` does not override it.
      () => http.request(`http://${OUTSIDE}/e`, { host: "127.0.0.1" }),
    ];
    for (const attempt of attempts) {
      expect(attempt).toThrow(`blocked a request to "${OUTSIDE}"`);
    }
    // Recorded as well as refused: the hook in no-network.ts fails any test that
    // leaves an entry here, even when the code under test swallowed the error.
    expect(takeBlockedRequests()).toEqual(attempts.map(() => OUTSIDE));
  });

  it("refuses a fetch that leaves this machine, as a rejected promise", async () => {
    const attempts = [
      () => fetch(`https://${OUTSIDE}/e`),
      () => fetch(new URL(`https://${OUTSIDE}/e`), { method: "POST", body: "{}" }),
      () => fetch(new Request(`http://${OUTSIDE}/e`)),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(`blocked a request to "${OUTSIDE}"`);
    }
    expect(takeBlockedRequests()).toEqual(attempts.map(() => OUTSIDE));
  });

  it("lets a request to a server on this machine through", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(local, (response) => {
          let text = "";
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => resolve(text));
        })
        .on("error", reject);
    });
    expect(body).toBe("ok");

    const fetched = await fetch(local);
    expect(await fetched.text()).toBe("ok");

    expect(takeBlockedRequests()).toEqual([]);
  });

  it("counts every spelling of this machine as local", () => {
    // Nothing listens on port 9; each request is dropped before it could matter.
    for (const url of ["http://localhost:9/", "http://127.0.0.1:9/", "http://[::1]:9/"]) {
      const request = http.request(url);
      request.on("error", () => {});
      request.destroy();
    }
    expect(takeBlockedRequests()).toEqual([]);
  });
});
