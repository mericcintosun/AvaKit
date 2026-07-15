/**
 * Anonymous, opt-out usage counting for create-avalanche-app.
 *
 * Why this exists: we need to answer "does anyone actually use this?" with a
 * number rather than a vibe — the Avalanche grant programs (Retro9000 especially)
 * score on demonstrated usage, and npm's download count can't distinguish a human
 * from a mirror or tell us which template anyone picked.
 *
 * The model is Next.js's: on by default, one plainly-worded notice on the first
 * run, trivial to turn off, and nothing that could identify a person or a project
 * ever leaves the machine.
 *
 * Sent:      template, wallet, chain, package manager, CLI version, OS platform,
 *            Node major, whether the scaffold succeeded, and a random id created
 *            on this machine — the id only separates "ten people ran it once"
 *            from "one person ran it ten times".
 * Not sent:  project name, any filesystem path, file contents, env vars, the text
 *            of an error (only a coarse `errorKind`), or an IP — the collector is
 *            written not to store one.
 *
 * Off when:  AVAKIT_TELEMETRY_DISABLED or DO_NOT_TRACK is set to a non-empty,
 *            non-"0" value, `--no-telemetry` is passed, the persisted config says
 *            so, or we're in CI — a robot's scaffold isn't adoption, and counting
 *            it would let our own smoke tests inflate the number we publish.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const ENDPOINT =
  process.env.AVAKIT_TELEMETRY_URL || "https://avakit-telemetry.avakit.workers.dev/e";

/** Hard ceiling on how long a send may delay the user's exit. */
const SEND_TIMEOUT_MS = 1500;

export const TELEMETRY_DOCS_URL = "https://avakit.dev/docs/telemetry";

/** Coarse failure buckets — never the raw error text, which can carry paths. */
export type ErrorKind = "dir-exists" | "scaffold-failed";

export interface ScaffoldEvent {
  template: string;
  wallet: string;
  chain: string;
  pm: string;
  ok: boolean;
  errorKind?: ErrorKind;
}

interface Config {
  anonymousId: string;
  /** ISO date of the run where we printed the first-run notice, if we have. */
  notifiedAt?: string;
  /** Set by `--no-telemetry`; env vars take precedence over this either way. */
  enabled?: boolean;
}

function envOn(name: string): boolean {
  const v = process.env[name];
  return v != null && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * CI detection. Deliberately broad: a false positive costs us one uncounted
 * scaffold, a false negative pollutes the public number with robots.
 */
function isCI(): boolean {
  return (
    envOn("CI") ||
    envOn("CONTINUOUS_INTEGRATION") ||
    envOn("GITHUB_ACTIONS") ||
    envOn("GITLAB_CI") ||
    envOn("CIRCLECI") ||
    envOn("TRAVIS") ||
    envOn("JENKINS_URL") ||
    envOn("BUILDKITE") ||
    envOn("TEAMCITY_VERSION") ||
    envOn("CODEBUILD_BUILD_ID") ||
    envOn("BUILD_NUMBER")
  );
}

/** `~/.config/avakit` (or the OS equivalent); AVAKIT_CONFIG_DIR overrides it. */
function configDir(): string {
  if (process.env.AVAKIT_CONFIG_DIR) return process.env.AVAKIT_CONFIG_DIR;
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "avakit",
    );
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "avakit");
}

export class Telemetry {
  private readonly cliVersion: string;
  private readonly file: string;
  private config: Config | null = null;
  private pending: Promise<void> | null = null;
  /** Reason we're off, or null if we're on. Computed once in the constructor. */
  private readonly disabledBy: "env" | "flag" | "ci" | "config" | "no-home" | null;

  /** @param flag `--telemetry` / `--no-telemetry`, or undefined if neither. */
  constructor(opts: { cliVersion: string; flag?: boolean }) {
    this.cliVersion = opts.cliVersion;
    this.file = path.join(configDir(), "config.json");

    // Either flag is a persisted preference, not a one-run mute — an opt-out you
    // have to retype every time isn't an opt-out, and an opt-out you can't undo
    // is a trap.
    if (opts.flag != null) this.write({ enabled: opts.flag });

    // The env vars win over the flag on purpose: DO_NOT_TRACK is a machine-wide
    // "never" and honouring it is the whole point of respecting the convention.
    if (envOn("AVAKIT_TELEMETRY_DISABLED") || envOn("DO_NOT_TRACK")) {
      this.disabledBy = "env";
    } else if (opts.flag === false) {
      this.disabledBy = "flag";
    } else if (isCI()) {
      this.disabledBy = "ci";
    } else {
      // Reading config can fail on a locked-down or read-only home; that's a
      // reason to stay quiet, not to fail the scaffold.
      const config = this.read();
      if (!config) this.disabledBy = "no-home";
      else if (config.enabled === false) this.disabledBy = "config";
      else this.disabledBy = null;
    }
  }

  get enabled(): boolean {
    return this.disabledBy === null;
  }

  private read(): Config | null {
    if (this.config) return this.config;
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Config>;
        if (typeof parsed.anonymousId === "string" && parsed.anonymousId) {
          this.config = parsed as Config;
          return this.config;
        }
      }
      // No config yet (or a corrupt one) — mint a fresh id and persist it.
      this.config = { anonymousId: randomUUID() };
      this.persist();
      return this.config;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.config) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.config, null, 2)}\n`);
    } catch {
      // Read-only home. We simply don't remember anything across runs.
    }
  }

  private write(patch: Partial<Config>): void {
    const config = this.read();
    if (!config) return;
    this.config = { ...config, ...patch };
    this.persist();
  }

  /**
   * The one-time disclosure. Returns the lines to print, or null if we've already
   * told this user (or there's nothing to disclose because we're off).
   *
   * Marks itself as shown immediately: a notice that reappears until a send
   * succeeds would nag people who are offline.
   */
  firstRunNotice(): string[] | null {
    if (!this.enabled) return null;
    const config = this.read();
    if (!config || config.notifiedAt) return null;
    this.write({ notifiedAt: new Date().toISOString().slice(0, 10) });
    return [
      "AvaKit collects completely anonymous usage data (which template, whether it",
      "worked) so we can show the Avalanche ecosystem that this gets used. No project",
      "names, no paths, no code, nothing that identifies you.",
      "",
      `Opt out any time:  AVAKIT_TELEMETRY_DISABLED=1  ·  ${TELEMETRY_DOCS_URL}`,
    ];
  }

  /**
   * Queue a scaffold event. Never throws and never blocks — the request is
   * started here and awaited (briefly, with a ceiling) in `flush()`.
   */
  record(event: ScaffoldEvent): void {
    if (!this.enabled) return;
    const config = this.read();
    if (!config) return;

    const body = JSON.stringify({
      event: "scaffold",
      anonymousId: config.anonymousId,
      template: event.template,
      wallet: event.wallet,
      chain: event.chain,
      pm: event.pm,
      ok: event.ok,
      ...(event.errorKind ? { errorKind: event.errorKind } : {}),
      cliVersion: this.cliVersion,
      platform: process.platform,
      nodeMajor: process.versions.node.split(".")[0],
    });

    this.pending = this.post(body);
  }

  /**
   * POST the event, giving up hard at SEND_TIMEOUT_MS.
   *
   * This is `node:http` rather than `fetch` on purpose. `fetch` with an
   * AbortSignal.timeout does reject on schedule, but undici leaves the pending
   * connect handle in the event loop, so against a black-holed network the CLI
   * printed "Done" and then sat there for ~10s with nothing to show for it.
   * Destroying the request frees the handle for real: measured 1.5s to exit
   * instead of 10.5s, with a healthy request still round-tripping in ~20ms.
   *
   * Never rejects — a telemetry failure must never surface to the user.
   */
  private post(body: string): Promise<void> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(ENDPOINT);
      } catch {
        return resolve();
      }
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      });
      const timer = setTimeout(() => request.destroy(), SEND_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      request.on("error", done);
      request.on("close", done);
      request.on("response", (response) => {
        response.resume(); // Drain, otherwise the socket is never released.
        response.on("end", done);
      });
      request.end(body);
    });
  }

  /**
   * Wait for a queued send, but never for long. We accept a bounded delay rather
   * than Next.js's detached-flush-process trick: the CLI has usually just spent
   * half a minute in `pnpm install`, so the ≤1.5s worst case is invisible and a
   * whole spawned process isn't worth the complexity.
   */
  async flush(): Promise<void> {
    if (!this.pending) return;
    await this.pending;
    this.pending = null;
  }
}
