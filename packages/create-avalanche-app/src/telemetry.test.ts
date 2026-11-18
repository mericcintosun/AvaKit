import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takeBlockedRequests } from "./testing/no-network.js";

/** Every variable that switches telemetry off; blanked so a test can switch it on. */
const OFF_SWITCHES = [
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
];

const EVENT = { template: "minimal", chain: "fuji", pm: "npm", ok: true } as const;

let configDir: string;
let server: http.Server;
let received: Record<string, unknown>[];
let endpoint: string;

beforeEach(async () => {
  configDir = mkdtempSync(path.join(tmpdir(), "caa-telemetry-"));
  received = [];
  // A collector on the loopback interface: nothing in this file leaves the machine.
  server = http.createServer((request, response) => {
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
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/e`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
  rmSync(configDir, { recursive: true, force: true });
});

/**
 * Load a fresh copy of the module with telemetry switched on, pointed at `url`
 * (the endpoint is read once, when the module loads).
 */
async function load(url: string = endpoint, env: Record<string, string> = {}) {
  for (const name of OFF_SWITCHES) vi.stubEnv(name, "");
  vi.stubEnv("AVAKIT_CONFIG_DIR", configDir);
  vi.stubEnv("AVAKIT_TELEMETRY_URL", url);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return import("./telemetry.js");
}

const configFile = () => path.join(configDir, "config.json");
const readConfig = () => JSON.parse(readFileSync(configFile(), "utf8")) as Record<string, unknown>;

describe("the test suite itself", () => {
  it("runs with telemetry off and aimed at this machine unless a test opts in", async () => {
    expect(process.env.AVAKIT_TELEMETRY_DISABLED).toBe("1");
    expect(new URL(process.env.AVAKIT_TELEMETRY_URL ?? "").hostname).toBe("127.0.0.1");
    const { Telemetry } = await import("./telemetry.js");
    expect(new Telemetry({ cliVersion: "1.2.3" }).enabled).toBe(false);
  });

  it("cannot send an event off this machine even when a test switches telemetry on", async () => {
    // What a careless test could do: telemetry on, endpoint somewhere else. A
    // name that can never resolve (RFC 2606) stands in for the real collector.
    const { Telemetry } = await load("https://collector.example.invalid/e");
    const telemetry = new Telemetry({ cliVersion: "1.2.3" });
    expect(telemetry.enabled).toBe(true);
    telemetry.record(EVENT);
    await telemetry.flush();

    // Refused by src/testing/no-network.ts, which would also have failed this
    // test had the refusal not been collected here.
    expect(takeBlockedRequests()).toEqual(["collector.example.invalid"]);
    expect(received).toEqual([]);
  });
});

describe("Telemetry", () => {
  it("sends one anonymous event with exactly the documented fields", async () => {
    const { Telemetry } = await load();
    const telemetry = new Telemetry({ cliVersion: "1.2.3" });
    expect(telemetry.enabled).toBe(true);

    telemetry.record(EVENT);
    await telemetry.flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      event: "scaffold",
      anonymousId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      template: "minimal",
      chain: "fuji",
      pm: "npm",
      ok: true,
      cliVersion: "1.2.3",
      platform: process.platform,
      nodeMajor: process.versions.node.split(".")[0],
    });
    // The id is minted once and reused, so ten runs are not ten people.
    expect(readConfig().anonymousId).toBe(received[0]?.anonymousId);
  });

  it("shows the first-run notice once", async () => {
    const { Telemetry } = await load();
    expect(new Telemetry({ cliVersion: "1.2.3" }).firstRunNotice()).toEqual(
      expect.arrayContaining([expect.stringContaining("AVAKIT_TELEMETRY_DISABLED=1")]),
    );
    expect(new Telemetry({ cliVersion: "1.2.3" }).firstRunNotice()).toBeNull();
  });

  it("stays off, and sends nothing, for each documented off switch", async () => {
    const switches: Record<string, string>[] = [
      { AVAKIT_TELEMETRY_DISABLED: "1" },
      { DO_NOT_TRACK: "1" },
      { CI: "true" },
    ];
    for (const env of switches) {
      const { Telemetry } = await load(endpoint, env);
      const telemetry = new Telemetry({ cliVersion: "1.2.3" });
      expect(telemetry.enabled, JSON.stringify(env)).toBe(false);
      expect(telemetry.firstRunNotice()).toBeNull();
      telemetry.record(EVENT);
      await telemetry.flush();
    }
    expect(received).toEqual([]);
    // Off by environment means the config file is not even created.
    expect(existsSync(configFile())).toBe(false);
  });

  it("persists --no-telemetry and --telemetry", async () => {
    const { Telemetry } = await load();
    const optedOut = new Telemetry({ cliVersion: "1.2.3", flag: false });
    expect(optedOut.enabled).toBe(false);
    expect(readConfig().enabled).toBe(false);
    // The next run has no flag, and is still off.
    expect(new Telemetry({ cliVersion: "1.2.3" }).enabled).toBe(false);

    expect(new Telemetry({ cliVersion: "1.2.3", flag: true }).enabled).toBe(true);
    expect(new Telemetry({ cliVersion: "1.2.3" }).enabled).toBe(true);
  });

  describe("a hand-written opt-out in config.json", () => {
    it("is honoured: nothing is sent and the opt-out is not overwritten", async () => {
      // The file the docs name, written by a user or a provisioning script. It
      // has no id, and minting one used to replace the whole file — dropping
      // `enabled: false` and sending an event in the same run.
      writeFileSync(configFile(), '{"enabled": false}\n');

      const { Telemetry } = await load();
      const telemetry = new Telemetry({ cliVersion: "1.2.3" });
      expect(telemetry.enabled).toBe(false);
      expect(telemetry.firstRunNotice()).toBeNull();
      telemetry.record(EVENT);
      await telemetry.flush();

      expect(received).toEqual([]);
      expect(readConfig().enabled).toBe(false);
      // And it stays off on the following run too.
      expect(new Telemetry({ cliVersion: "1.2.3" }).enabled).toBe(false);
    });

    it("keeps the other fields when an id has to be minted", async () => {
      writeFileSync(configFile(), '{"notifiedAt": "2026-01-02"}\n');
      const { Telemetry } = await load();
      const telemetry = new Telemetry({ cliVersion: "1.2.3" });
      expect(telemetry.enabled).toBe(true);
      // Already notified, so no second notice.
      expect(telemetry.firstRunNotice()).toBeNull();
      expect(readConfig()).toEqual({
        notifiedAt: "2026-01-02",
        anonymousId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });

    it("can be reversed with --telemetry", async () => {
      writeFileSync(configFile(), '{"enabled": false, "notifiedAt": "2026-01-02"}\n');
      const { Telemetry } = await load();
      const telemetry = new Telemetry({ cliVersion: "1.2.3", flag: true });
      expect(telemetry.enabled).toBe(true);
      telemetry.record(EVENT);
      await telemetry.flush();
      expect(received).toHaveLength(1);
      expect(received[0]?.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
      expect(readConfig()).toMatchObject({ enabled: true, notifiedAt: "2026-01-02" });
    });

    it("reads the other plain spellings of off as an opt-out too", async () => {
      for (const enabled of ['"false"', "0", '"off"', '"No"']) {
        writeFileSync(configFile(), `{"enabled": ${enabled}}\n`);
        const { Telemetry } = await load();
        expect(new Telemetry({ cliVersion: "1.2.3" }).enabled, enabled).toBe(false);
        expect(readConfig().enabled, enabled).toBe(false);
      }
      expect(received).toEqual([]);
    });

    it("leaves keys it does not know about in the file", async () => {
      writeFileSync(configFile(), '{"enabled": false, "note": "set by IT"}\n');
      const { Telemetry } = await load();
      new Telemetry({ cliVersion: "1.2.3" });
      expect(readConfig()).toMatchObject({ enabled: false, note: "set by IT" });
    });

    it("stays off when the file is not valid JSON, rather than guessing", async () => {
      writeFileSync(configFile(), "enabled: false\n");
      const { Telemetry } = await load();
      const telemetry = new Telemetry({ cliVersion: "1.2.3" });
      expect(telemetry.enabled).toBe(false);
      telemetry.record(EVENT);
      await telemetry.flush();
      expect(received).toEqual([]);
      expect(readFileSync(configFile(), "utf8")).toBe("enabled: false\n");
    });
  });

  describe("a telemetry failure never reaches the user", () => {
    it("does not reject when the endpoint has no http(s) scheme", async () => {
      // `localhost:8787/e` parses as a URL whose protocol is "localhost:", and
      // building the request threw — failing the run after a successful scaffold.
      for (const url of ["localhost:8787/e", "ftp://127.0.0.1/e", "file:///tmp/e", "not a url"]) {
        const { Telemetry } = await load(url);
        const telemetry = new Telemetry({ cliVersion: "1.2.3" });
        expect(telemetry.enabled).toBe(true);
        expect(() => telemetry.record(EVENT), url).not.toThrow();
        await expect(telemetry.flush(), url).resolves.toBeUndefined();
      }
      expect(received).toEqual([]);
    });

    it("does not reject when nothing is listening", async () => {
      const { port } = server.address() as AddressInfo;
      await new Promise((resolve) => server.close(resolve));
      const { Telemetry } = await load(`http://127.0.0.1:${port}/e`);
      const telemetry = new Telemetry({ cliVersion: "1.2.3" });
      telemetry.record(EVENT);
      await expect(telemetry.flush()).resolves.toBeUndefined();
      // Listen again so afterEach has a server to close.
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    });
  });

  it("never sends a value it does not recognise, such as a path", async () => {
    // "Not sent: any filesystem path" has to hold whatever a caller passes in.
    const { Telemetry } = await load();
    const telemetry = new Telemetry({ cliVersion: "1.2.3" });
    telemetry.record({
      template: "../../Users/alice/secret-project",
      chain: "mainnet",
      pm: "/Users/alice/.local/share/pnpm/pnpm",
      ok: true,
    });
    await telemetry.flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ template: "other", chain: "other", pm: "other" });
    expect(JSON.stringify(received[0])).not.toContain("alice");
  });

  it("sends every known template, chain and package manager as itself", async () => {
    const { Telemetry } = await load();
    const telemetry = new Telemetry({ cliVersion: "1.2.3" });
    const combos = [
      { template: "nft-mint", chain: "fuji", pm: "pnpm" },
      { template: "token-gated-app", chain: "c-chain", pm: "yarn" },
      { template: "l1-launch", chain: "fuji", pm: "bun" },
    ];
    for (const combo of combos) {
      telemetry.record({ ...combo, ok: false, errorKind: "scaffold-failed" });
      await telemetry.flush();
    }
    expect(received.map(({ template, chain, pm }) => ({ template, chain, pm }))).toEqual(combos);
    expect(received.every((event) => event.errorKind === "scaffold-failed")).toBe(true);
  });
});
