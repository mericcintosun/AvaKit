import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listTemplates } from "./api.js";
import { projectNameProblem, run } from "./cli.js";
import { type Collector, startCollector, TELEMETRY_OFF_SWITCHES } from "./testing/collector.js";
import { canFakeBin, FAKE_BIN_TIMEOUT_MS, type FakeBin, fakeBin } from "./testing/fake-bin.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes.
const ANSI = /\u001b\[[0-9;]*m/g;

const PNPM_AGENT = "pnpm/10.20.0 npm/? node/v24.11.0 darwin arm64";

let cwd: string;
let configDir: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "caa-cli-"));
  configDir = mkdtempSync(path.join(tmpdir(), "caa-cli-config-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

/**
 * Run the CLI in-process and collect what it printed. Non-interactive unless `tty`.
 *
 * `run()` takes its telemetry settings from the environment it is handed, and
 * every run here is handed one with telemetry off, aimed at this machine, and
 * keeping its config in a throwaway directory. So no scaffold in this file can
 * be counted as usage or touch the real config, however the tests are launched
 * — even without this package's vitest config. A test of telemetry itself
 * overrides these in `env`, with a collector of its own.
 */
async function invoke(
  argv: string[],
  env: NodeJS.ProcessEnv = {},
  tty = false,
  platform: NodeJS.Platform = process.platform,
) {
  let stdout = "";
  let stderr = "";
  const code = await run({
    argv,
    cwd,
    env: {
      AVAKIT_TELEMETRY_DISABLED: "1",
      AVAKIT_TELEMETRY_URL: "http://127.0.0.1:9/e",
      AVAKIT_CONFIG_DIR: configDir,
      ...env,
    },
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    stdinIsTTY: tty,
    platform,
  });
  return { code, stdout: stdout.replace(ANSI, ""), stderr: stderr.replace(ANSI, "") };
}

describe("projectNameProblem", () => {
  it("accepts a safe name whose directory is free or empty", () => {
    expect(projectNameProblem("my-app", cwd)).toBeNull();
    mkdirSync(path.join(cwd, "empty"));
    expect(projectNameProblem("empty", cwd)).toBeNull();
  });

  it("explains an unsafe name with the scaffolder's own message", () => {
    for (const name of ["my-app-", "app.", "../evil", "a".repeat(65)]) {
      expect(projectNameProblem(name, cwd), name).toContain("Invalid project name");
    }
  });

  it("reports a directory that already has files", () => {
    mkdirSync(path.join(cwd, "taken"));
    writeFileSync(path.join(cwd, "taken", "notes.txt"), "keep me");
    expect(projectNameProblem("taken", cwd)).toBe(
      'Directory "taken" already exists and is not empty.',
    );
  });

  it("reports a name that is already a file, instead of throwing", () => {
    writeFileSync(path.join(cwd, "notes"), "keep me");
    expect(projectNameProblem("notes", cwd)).toBe('"notes" already exists and is not a directory.');
  });
});

describe("create-avalanche-app (interactive)", () => {
  it("checks a name from the command line before asking any question", async () => {
    mkdirSync(path.join(cwd, "taken"));
    writeFileSync(path.join(cwd, "taken", "notes.txt"), "keep me");

    // Had this got as far as the wizard, the test would hang on its first prompt.
    const taken = await invoke(["taken"], {}, true);
    expect(taken.code).toBe(1);
    expect(taken.stderr).toContain('Error: Directory "taken" already exists and is not empty.');

    const unsafe = await invoke(["my-app-"], {}, true);
    expect(unsafe.code).toBe(1);
    expect(unsafe.stderr).toContain('Invalid project name "my-app-"');
  });

  it("rejects a bad flag value rather than silently asking again", async () => {
    const result = await invoke(["app", "--template", "nft"], {}, true);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unknown template "nft". Valid templates:');
  });
});

describe("create-avalanche-app (non-interactive)", () => {
  it("prints the version and the help without scaffolding", async () => {
    const version = await invoke(["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/);

    const help = await invoke(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--pm <manager>");
    expect(help.stdout).toContain("pnpm | npm | yarn | bun");
  });

  it("skips the install with --no-install and lists it as a next step", async () => {
    const result = await invoke(["app", "--yes", "--no-install"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Done. Next steps:\n  cd app\n  npm install\n  npm run dev\n");
    expect(existsSync(path.join(cwd, "app", "package.json"))).toBe(true);
    expect(existsSync(path.join(cwd, "app", "node_modules"))).toBe(false);
  });

  it("puts a template's one-time setup command between install and dev", async () => {
    const result = await invoke(["app", "--yes", "--no-install", "--template", "icm-messenger"], {
      npm_config_user_agent: PNPM_AGENT,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "Next steps:\n  cd app\n  pnpm install\n  pnpm run devnet\n  pnpm run dev\n",
    );
  });

  it("rejects an unknown --pm before creating anything", async () => {
    const result = await invoke(["app", "--yes", "--pm", "/usr/local/bin/pnpm"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unknown package manager "/usr/local/bin/pnpm"');
    expect(result.stderr).toContain("Valid package managers: pnpm, npm, yarn, bun.");
    expect(existsSync(path.join(cwd, "app"))).toBe(false);
  });

  it("rejects an unknown template instead of scaffolding the minimal one", async () => {
    // The published 0.4.1 created the `minimal` app here and exited 0.
    const result = await invoke(["app", "--template", "nft", "--yes", "--no-install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error: Unknown template "nft". Valid templates: minimal,');
    expect(result.stderr).toContain("Run with --help to see the available options.");
    expect(result.stdout).toBe("");
    expect(existsSync(path.join(cwd, "app"))).toBe(false);
  });

  it("rejects an unknown chain instead of falling back to Fuji", async () => {
    const result = await invoke(["app", "--chain", "mainnet", "--yes", "--no-install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error: Unknown chain "mainnet". Valid chains: fuji, c-chain.');
    expect(existsSync(path.join(cwd, "app"))).toBe(false);
  });

  it("rejects a mistyped flag instead of ignoring it", async () => {
    const result = await invoke(["app", "--tempalte", "nft-mint", "--yes", "--no-install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error: Unknown option "--tempalte".');
    expect(existsSync(path.join(cwd, "app"))).toBe(false);
  });

  it("rejects an unsafe project name before creating anything", async () => {
    const result = await invoke(["../outside", "--yes", "--no-install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid project name "../outside"');
    expect(existsSync(path.join(cwd, "..", "outside"))).toBe(false);
  });

  it("refuses C-Chain for a Fuji-only template, naming the chains it supports", async () => {
    // 0.4.1 scaffolded these: an nft-mint app whose Deploy button could only
    // ever be refused, and an eerc-token app reading a Fuji address on mainnet.
    for (const template of ["nft-mint", "erc20-token", "token-gated-app", "eerc-token"]) {
      const result = await invoke([
        "app",
        "--template",
        template,
        "--chain",
        "c-chain",
        "--yes",
        "--no-install",
      ]);
      expect(result.code, template).toBe(1);
      expect(result.stderr).toContain(
        `Error: Template "${template}" cannot be scaffolded for chain "c-chain". It supports: fuji.`,
      );
      expect(result.stdout).toBe("");
      expect(existsSync(path.join(cwd, "app"))).toBe(false);
    }
  });

  it("refuses C-Chain for the devnet templates, which never used the flag", async () => {
    for (const template of ["icm-messenger", "l1-launch", "token-bridge"]) {
      const result = await invoke(["app", "-t", template, "-c", "c-chain", "-y", "--no-install"]);
      expect(result.code, template).toBe(1);
      expect(result.stderr).toContain(`Template "${template}" cannot be scaffolded for chain`);
      expect(existsSync(path.join(cwd, "app"))).toBe(false);
    }
  });

  it("still scaffolds every template for Fuji, the default", async () => {
    for (const template of listTemplates()) {
      const result = await invoke([
        template.id,
        "--template",
        template.id,
        "--yes",
        "--no-install",
      ]);
      expect(result.code, template.id).toBe(0);
      expect(existsSync(path.join(cwd, template.id, "package.json")), template.id).toBe(true);
    }
  });

  it("says in --help which templates can target mainnet", async () => {
    const help = await invoke(["--help"]);
    expect(help.stdout).toContain("c-chain (mainnet) only with: minimal");
  });

  it("scaffolds the template and chain that were asked for", async () => {
    const result = await invoke([
      "app",
      "--template=minimal",
      "--chain=c-chain",
      "--yes",
      "--no-install",
    ]);
    expect(result.code).toBe(0);
    const providers = readFileSync(path.join(cwd, "app", "app", "providers.tsx"), "utf8");
    expect(providers).toContain("chains={[cChain]}");
  });

  it("refuses a directory that already has files in it", async () => {
    await invoke(["app", "--yes", "--no-install"]);
    const again = await invoke(["app", "--yes", "--no-install"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('Directory "app" already exists and is not empty.');
  });

  it("refuses a name that is already a file", async () => {
    writeFileSync(path.join(cwd, "notes"), "keep me");
    const result = await invoke(["notes", "--yes", "--no-install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('"notes" already exists and is not a directory.');
    expect(readFileSync(path.join(cwd, "notes"), "utf8")).toBe("keep me");
  });
});

describe("create-avalanche-app telemetry", () => {
  let collector: Collector;

  beforeEach(async () => {
    // On the loopback interface: nothing here leaves the machine.
    collector = await startCollector();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await collector.close();
  });

  /** An environment in which telemetry is on and reports to the local collector. */
  const counted = (): NodeJS.ProcessEnv => ({
    AVAKIT_TELEMETRY_DISABLED: "",
    AVAKIT_TELEMETRY_URL: collector.url,
  });

  it("reports a scaffold once, anonymously, and says so on the first run only", async () => {
    const first = await invoke(["secret-project", "--yes", "--no-install"], counted());
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("AvaKit collects completely anonymous usage data");
    expect(collector.received).toEqual([
      expect.objectContaining({
        event: "scaffold",
        template: "minimal",
        chain: "fuji",
        pm: "npm",
        ok: true,
      }),
    ]);
    // Neither the project's name nor where it was created.
    const sent = JSON.stringify(collector.received);
    expect(sent).not.toContain("secret-project");
    expect(sent).not.toContain(path.basename(cwd));

    const second = await invoke(["another", "--yes", "--no-install"], counted());
    expect(second.code).toBe(0);
    expect(second.stdout).not.toContain("anonymous usage data");
    expect(collector.received).toHaveLength(2);
    // The same machine, so the same random id: two runs are not two people.
    expect(collector.received[1]?.anonymousId).toBe(collector.received[0]?.anonymousId);
  });

  it("reports a refused directory as a failed scaffold", async () => {
    mkdirSync(path.join(cwd, "taken"));
    writeFileSync(path.join(cwd, "taken", "notes.txt"), "keep me");
    const result = await invoke(["taken", "-t", "nft-mint", "--yes", "--no-install"], counted());
    expect(result.code).toBe(1);
    expect(collector.received).toEqual([
      expect.objectContaining({ template: "nft-mint", ok: false, errorKind: "dir-exists" }),
    ]);
  });

  it("remembers --no-telemetry for the runs that follow", async () => {
    const optedOut = await invoke(["one", "--yes", "--no-install", "--no-telemetry"], counted());
    expect(optedOut.code).toBe(0);
    expect(optedOut.stdout).not.toContain("anonymous usage data");
    // No flag this time, and still nothing is sent.
    const next = await invoke(["two", "--yes", "--no-install"], counted());
    expect(next.code).toBe(0);
    expect(collector.received).toEqual([]);
  });

  it("is decided by the environment the run is given, never by the process's own", async () => {
    // What a test run looks like when nothing has switched telemetry off for
    // the process: on, with somewhere to report to and a config directory.
    const ambientConfig = path.join(configDir, "ambient");
    for (const name of TELEMETRY_OFF_SWITCHES) vi.stubEnv(name, "");
    vi.stubEnv("AVAKIT_TELEMETRY_URL", collector.url);
    vi.stubEnv("AVAKIT_CONFIG_DIR", ambientConfig);

    // The run is handed an environment in which telemetry is off, and that wins:
    // this is what keeps every other scaffold in this file from being counted.
    const quiet = await invoke(["app", "--yes", "--no-install"]);
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).not.toContain("anonymous usage data");
    expect(collector.received).toEqual([]);
    expect(existsSync(ambientConfig)).toBe(false);

    // And the other way round: off in the process, on for the run.
    vi.stubEnv("AVAKIT_TELEMETRY_DISABLED", "1");
    const loud = await invoke(["other", "--yes", "--no-install"], counted());
    expect(loud.code).toBe(0);
    expect(collector.received).toHaveLength(1);
  });
});

describe.skipIf(!canFakeBin)(
  "create-avalanche-app install step",
  { timeout: FAKE_BIN_TIMEOUT_MS },
  () => {
    let bin: FakeBin;
    const appDir = () => path.join(realpathSync(cwd), "app");

    beforeAll(() => {
      bin = fakeBin(["pnpm", "npm", "yarn", "bun"]);
    });
    afterAll(() => bin.cleanup());
    beforeEach(() => bin.reset());

    it("installs with the package manager the user launched it with", async () => {
      const result = await invoke(
        ["app", "--yes"],
        bin.env({}, { npm_config_user_agent: PNPM_AGENT }),
      );
      expect(result.code).toBe(0);
      expect(bin.calls()).toEqual([`pnpm install @ ${appDir()}`]);
      // Installed, so the install is not a "next step" any more.
      expect(result.stdout).toContain("Done. Next steps:\n  cd app\n  pnpm run dev\n");
    });

    it("detects yarn and bun the same way", async () => {
      await invoke(
        ["one", "--yes"],
        bin.env({}, { npm_config_user_agent: "yarn/1.22.22 npm/? node/v24.11.0 linux x64" }),
      );
      await invoke(
        ["two", "--yes"],
        bin.env({}, { npm_config_user_agent: "bun/1.3.0 npm/? node/v24.3.0 linux x64" }),
      );
      expect(bin.calls().map((call) => call.split(" @ ")[0])).toEqual([
        "yarn install",
        "bun install",
      ]);
    });

    it("falls back to npm when it cannot tell which manager launched it", async () => {
      const result = await invoke(["app", "--yes"], bin.env());
      expect(result.code).toBe(0);
      expect(bin.calls()).toEqual([`npm install @ ${appDir()}`]);
      expect(result.stdout).toContain("npm run dev");
    });

    it("lets --pm override the detected manager", async () => {
      const result = await invoke(
        ["app", "--yes", "--pm", "bun"],
        bin.env({}, { npm_config_user_agent: "npm/11.6.0 node/v24.11.0 darwin arm64" }),
      );
      expect(result.code).toBe(0);
      expect(bin.calls()).toEqual([`bun install @ ${appDir()}`]);
    });

    it("exits non-zero and prints the manual steps when the install fails", async () => {
      const result = await invoke(["app", "--yes"], bin.env({ exit: 1 }));
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain("Done");
      expect(result.stderr).toContain(
        'Error: Dependencies were not installed: "npm install" exited with code 1.',
      );
      expect(result.stderr).toContain(
        "The project was created in ./app. To finish the setup yourself:\n  cd app\n  npm install\n  npm run dev\n",
      );
      // The scaffold itself is intact; only the install is missing.
      expect(existsSync(path.join(cwd, "app", "package.json"))).toBe(true);
    });

    it("exits non-zero and says so when the package manager is not installed", async () => {
      // The published 0.4.1 printed "Done" and exited 0 here.
      const result = await invoke(
        ["app", "--yes", "--template", "nft-mint"],
        bin.emptyEnv({ npm_config_user_agent: PNPM_AGENT }),
      );
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain("Done");
      expect(result.stderr).toContain(
        'Error: Dependencies were not installed: "pnpm" was not found on your PATH.',
      );
      expect(result.stderr).toContain(
        "Install pnpm first, or pick a package manager you have with --pm (pnpm | npm | yarn | bun).",
      );
      expect(result.stderr).toContain("  cd app\n  pnpm install\n  pnpm run dev\n");
    });

    it("starts the package manager through a shell when the platform is Windows", async () => {
      // There npm, pnpm and yarn are .cmd shims that Node cannot start directly,
      // so every install used to fail. Run here, the same code path goes through
      // /bin/sh instead of cmd.exe — which still proves the command is launched
      // as one shell string and its result is read back.
      const installed = await invoke(
        ["app", "--yes"],
        bin.env({}, { npm_config_user_agent: PNPM_AGENT }),
        false,
        "win32",
      );
      expect(installed.code).toBe(0);
      expect(bin.calls()).toEqual([`pnpm install @ ${appDir()}`]);

      const failed = await invoke(["other", "--yes"], bin.env({ exit: 1 }), false, "win32");
      expect(failed.code).toBe(1);
      expect(failed.stderr).toContain(
        'Dependencies were not installed: "npm install" exited with code 1.',
      );
    });
  },
);
