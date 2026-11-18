import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scaffold } from "./scaffold.js";

/**
 * What the published tarball contains when it is packed from a working tree
 * that tools have been run in.
 *
 * `files` in package.json allows `templates`, and an allowed directory is
 * packed with everything in it: a root `.npmignore` does not take anything back
 * out, and the root `.gitignore` is not consulted at all. So `forge build` in a
 * template, or a `.env` left there, used to go into the tarball and from there
 * into every scaffolded app. The negated entries of `files` are what keeps them
 * out, and this is the test of them: the package's real package.json, a
 * template with such files in it, and npm's own answer to what it would pack.
 */

const PACKAGE_JSON = fileURLToPath(new URL("../package.json", import.meta.url));

/** A template as it ships. `app/out` and `lib/cache` are ordinary names outside `contracts`. */
const SHIPPED = [
  "manifest.json",
  "package.json",
  "gitignore",
  "env.example",
  "cursor/rules/avakit.mdc",
  "app/page.tsx",
  "app/out/page.tsx",
  "lib/cache/index.ts",
  "lib/broadcast.ts",
  "contracts/foundry.toml",
  "contracts/src/Token.sol",
  // An example file under its real name is still an example file.
  "contracts/.env.example",
];

/** What tools and developers leave in a template directory. None of it may be packed. */
const LEFT_BEHIND = [
  // forge build, forge script --broadcast
  "contracts/out/Token.sol/Token.json",
  "contracts/out/build-info/0123abcd.json",
  "contracts/cache/solidity-files-cache.json",
  "contracts/broadcast/Deploy.s.sol/43113/run-latest.json",
  // an install, at any depth
  "node_modules/react/index.js",
  "node_modules/.bin/next",
  "contracts/node_modules/forge-std/package.json",
  // a Next.js or Turborepo build
  ".next/BUILD_ID",
  ".next/cache/webpack/client/0.pack",
  ".turbo/turbo-build.log",
  // environment files, which can hold a key
  ".env",
  ".env.local",
  ".env.production.local",
  "contracts/.env",
];

const TEMPLATE = "templates/fixture";

let dir: string;
/** What `npm pack` would put in the tarball, as npm lists it. */
let packed: string[];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "caa-pack-"));
  cpSync(PACKAGE_JSON, path.join(dir, "package.json"));
  const write = (file: string) => {
    const full = path.join(dir, ...file.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "fixture\n");
  };
  write("dist/index.js");
  for (const file of [...SHIPPED, ...LEFT_BEHIND]) write(`${TEMPLATE}/${file}`);

  // A dry run: nothing is written, and nothing is asked of the registry. The
  // command line is fixed, which is what makes the shell safe on Windows, where
  // npm is a .cmd shim and cannot be started without one.
  const npm = spawnSync("npm pack --dry-run --json --ignore-scripts", {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
    },
  });
  if (npm.status !== 0) {
    throw new Error(`npm pack --dry-run failed (${npm.status ?? npm.error}):\n${npm.stderr}`);
  }
  const [report] = JSON.parse(npm.stdout) as [{ files: { path: string }[] }];
  packed = report.files.map((file) => file.path).sort();
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the published tarball", () => {
  it("packs a template without anything a tool or a developer left in it", () => {
    const leaked = LEFT_BEHIND.map((file) => `${TEMPLATE}/${file}`).filter((file) =>
      packed.includes(file),
    );
    expect(leaked).toEqual([]);
  });

  it("still packs every file of the template itself", () => {
    // An exclusion that is too wide would be as wrong as one that is missing:
    // `app/out` and `lib/cache` are a route and a module, not Foundry output.
    expect(packed.filter((file) => file.startsWith("templates/"))).toEqual(
      SHIPPED.map((file) => `${TEMPLATE}/${file}`).sort(),
    );
    expect(packed).toContain("dist/index.js");
    expect(packed).toContain("package.json");
  });

  it("leaves out exactly what the scaffolder leaves out of an app", async () => {
    // The same template, scaffolded: package.json's `files` and scaffold.ts's
    // list of left-behind files are two statements of one rule.
    const written = await scaffold({
      templateDir: path.join(dir, ...TEMPLATE.split("/")),
      targetDir: path.join(dir, "app"),
      replacements: {},
    });
    // The scaffolder restores the dots npm cannot ship and drops the manifest.
    const restored: Record<string, string> = {
      gitignore: ".gitignore",
      "env.example": ".env.example",
      "cursor/rules/avakit.mdc": ".cursor/rules/avakit.mdc",
    };
    expect(written.map((file) => file.split(path.sep).join("/")).sort()).toEqual(
      SHIPPED.filter((file) => file !== "manifest.json")
        .map((file) => restored[file] ?? file)
        .sort(),
    );
  });
});
