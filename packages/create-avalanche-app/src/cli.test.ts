import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { canFakeBin, FAKE_BIN_TIMEOUT_MS, type FakeBin, fakeBin } from "./testing/fake-bin.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes.
const ANSI = /\u001b\[[0-9;]*m/g;

const PNPM_AGENT = "pnpm/10.20.0 npm/? node/v24.11.0 darwin arm64";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "caa-cli-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

/** Run the CLI in-process, non-interactively, and collect what it printed. */
async function invoke(argv: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  const code = await run({
    argv,
    cwd,
    env,
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    stdinIsTTY: false,
    platform: process.platform,
  });
  return { code, stdout: stdout.replace(ANSI, ""), stderr: stderr.replace(ANSI, "") };
}

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

  it("refuses a directory that already has files in it", async () => {
    await invoke(["app", "--yes", "--no-install"]);
    const again = await invoke(["app", "--yes", "--no-install"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('Directory "app" already exists and is not empty.');
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
  },
);
