/**
 * Test helper: a stand-in for the telemetry collector that listens on this
 * machine only, and the variables a test has to blank to switch telemetry on.
 * A test that exercises telemetry reports to one of these — never to the real
 * collector, whose numbers are public.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Every variable that switches telemetry off. To switch it on a test blanks
 * them all: the suite sets the first, and a CI runner sets several of the rest.
 */
export const TELEMETRY_OFF_SWITCHES = [
  "AVAKIT_TELEMETRY_DISABLED",
  "DO_NOT_TRACK",
  "CI",
  "CONTINUOUS_INTEGRATION",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "JENKINS_URL",
  "BUILDKITE",
  "TEAMCITY_VERSION",
  "CODEBUILD_BUILD_ID",
  "BUILD_NUMBER",
] as const;

export interface Collector {
  /** The address to report to: the loopback interface, on a port the OS picked. */
  url: string;
  /** Every event received so far, in order. */
  received: Record<string, unknown>[];
  /** Stop listening. Safe to call twice. */
  close(): Promise<void>;
}

export async function startCollector(): Promise<Collector> {
  const received: Record<string, unknown>[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push(JSON.parse(body) as Record<string, unknown>);
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/e`,
    received,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
