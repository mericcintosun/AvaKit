/**
 * `scripts/bundle-audit.mjs`: what the build refuses to ship, and the licence
 * notices it writes. Each case is a small fake install on disk and a metafile
 * shaped like the bundler's; the real build is covered by dist.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface BundledPackage {
  name: string;
  version: string;
  license: string | undefined;
  licenseText: string;
  bytes: number;
}
interface Metafile {
  outputs: Record<
    string,
    {
      entryPoint?: string;
      inputs: Record<string, { bytesInOutput: number }>;
      imports?: { path: string; kind: string; external?: boolean }[];
    }
  >;
}
interface Audit {
  ALLOWED_LICENSES: string[];
  licenseAllowed(expression: string): boolean;
  auditBundle(
    metafile: Metafile,
    options: { cwd: string; self: string },
  ): { packages: BundledPackage[]; problems: string[]; notices: string };
}

// A plain script, outside what TypeScript compiles: loaded by its location.
const script = new URL("../scripts/bundle-audit.mjs", import.meta.url).href;
const audit = (await import(script)) as Audit;

const SELF = "@avakit/example";
const MIT_TEXT = "MIT License\r\n\r\nCopyright (c) someone\r\n";

let root: string;
let cwd: string;

/** Create a package under `dir` (relative to the fake repo) and return a path to one of its files. */
function addPackage(
  dir: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const abs = path.join(root, dir);
  mkdirSync(path.join(abs, "lib"), { recursive: true });
  writeFileSync(path.join(abs, "package.json"), JSON.stringify(manifest));
  writeFileSync(path.join(abs, "lib", "index.js"), "");
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(abs, name), content);
  return path.relative(cwd, path.join(abs, "lib", "index.js"));
}

/** A metafile with one output made of `inputs` (every one 10 bytes unless given) and `imports`. */
function metafileOf(
  inputs: (string | [file: string, bytes: number])[],
  imports: { path: string; kind: string; external?: boolean }[] = [],
): Metafile {
  return {
    outputs: {
      "dist/index.js": {
        entryPoint: "src/index.ts",
        inputs: Object.fromEntries(
          inputs.map((input) =>
            typeof input === "string"
              ? [input, { bytesInOutput: 10 }]
              : [input[0], { bytesInOutput: input[1] }],
          ),
        ),
        imports,
      },
    },
  };
}

const run = (metafile: Metafile) => audit.auditBundle(metafile, { cwd, self: SELF });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "avakit-bundle-audit-"));
  // The package being built, two levels down as in the monorepo.
  cwd = path.join(root, "packages", "example");
  mkdirSync(path.join(cwd, "src"), { recursive: true });
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: SELF, version: "1.0.0" }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("which packages are in the bundle", () => {
  it("finds installed, scoped, nested and workspace packages, and leaves the package itself out", () => {
    const plain = addPackage(
      "node_modules/.pnpm/plain@1.0.0/node_modules/plain",
      { name: "plain", version: "1.0.0", license: "MIT" },
      { LICENSE: MIT_TEXT },
    );
    const scoped = addPackage(
      "node_modules/.pnpm/@scope+pkg@2.1.0/node_modules/@scope/pkg",
      { name: "@scope/pkg", version: "2.1.0", license: "ISC" },
      { "LICENSE.md": "ISC text" },
    );
    const nested = addPackage(
      "node_modules/plain/node_modules/nested",
      { name: "nested", version: "0.3.0", license: "BSD-3-Clause" },
      { "license.txt": "BSD text" },
    );
    // A workspace package is linked, so the bundler reports its real path. Its
    // build folder holds a package.json of its own, which is not the package's.
    const workspace = addPackage(
      "packages/core",
      { name: "@avakit/core", version: "0.2.1", license: "MIT" },
      { LICENSE: "core licence" },
    );
    mkdirSync(path.join(root, "packages", "core", "dist"));
    writeFileSync(path.join(root, "packages", "core", "dist", "package.json"), '{"type":"module"}');
    writeFileSync(path.join(root, "packages", "core", "dist", "index.js"), "");

    const { packages, problems } = run(
      metafileOf([
        "src/index.ts",
        "src/server.ts",
        plain,
        [plain.replace("index.js", "other.js"), 5],
        scoped,
        nested,
        workspace,
        "../core/dist/index.js",
      ]),
    );
    expect(problems).toEqual([]);
    expect(
      packages.map(({ name, version, license, bytes }) => [name, version, license, bytes]),
    ).toEqual([
      ["@avakit/core", "0.2.1", "MIT", 20],
      ["@scope/pkg", "2.1.0", "ISC", 10],
      ["nested", "0.3.0", "BSD-3-Clause", 10],
      ["plain", "1.0.0", "MIT", 15],
    ]);
  });

  it("leaves out a package whose files were all tree-shaken away", () => {
    const used = addPackage("node_modules/used", {
      name: "used",
      version: "1.0.0",
      license: "MIT",
    });
    // No licence at all: it would fail the build if it counted as bundled.
    const shaken = addPackage("node_modules/shaken", { name: "shaken", version: "1.0.0" });
    const { packages, problems } = run(metafileOf([used, [shaken, 0]]));
    expect(packages.map((entry) => entry.name)).toEqual(["used"]);
    expect(problems).toEqual([]);
  });
});

describe("licences", () => {
  it("accepts every licence on the allow-list, and expressions that can be met from it", () => {
    expect(audit.ALLOWED_LICENSES).toEqual([
      "MIT",
      "ISC",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "Apache-2.0",
      "0BSD",
      "BlueOak-1.0.0",
      "Unlicense",
      "CC0-1.0",
    ]);
    for (const id of audit.ALLOWED_LICENSES) expect(audit.licenseAllowed(id), id).toBe(true);
    expect(audit.licenseAllowed("(MIT OR GPL-3.0-only)")).toBe(true);
    expect(audit.licenseAllowed("MIT AND ISC")).toBe(true);
    expect(audit.licenseAllowed("GPL-2.0 OR MIT AND CC0-1.0")).toBe(true);
  });

  it("refuses everything else", () => {
    for (const expression of [
      "GPL-3.0-only",
      "LGPL-2.1",
      "AGPL-3.0",
      "MPL-2.0",
      "UNLICENSED",
      "SEE LICENSE IN LICENSE",
      "MIT AND GPL-3.0-only",
      "Apache-2.0 WITH LLVM-exception",
      // Nested: not worked out, so not allowed — the first of these would
      // otherwise pass on its "MIT" although GPL-3.0-only applies as well.
      "(MIT OR ISC) AND (GPL-3.0-only)",
      "(MIT AND CC0-1.0) OR GPL-2.0",
      "mit",
      "",
    ]) {
      expect(audit.licenseAllowed(expression), expression).toBe(false);
    }
  });

  it("fails on a bundled package with neither a licence file nor a license field, naming it", () => {
    const bare = addPackage("node_modules/bare", { name: "bare", version: "4.5.6" });
    expect(run(metafileOf([bare])).problems).toEqual([
      'bare@4.5.6 is bundled but has neither a licence file nor a "license" field in its package.json.',
    ]);
  });

  it("fails on a licence that is not on the allow-list, naming the package and the licence", () => {
    const copyleft = addPackage(
      "node_modules/copyleft",
      { name: "copyleft", version: "1.0.0", license: "GPL-3.0-only" },
      { LICENSE: "GPL text" },
    );
    const { problems } = run(metafileOf([copyleft]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('copyleft@1.0.0 is bundled and licensed "GPL-3.0-only"');
    expect(problems[0]).toContain("not on the allow-list (MIT, ISC, ");
  });

  it("fails on a licence file that package.json does not name, because it cannot be checked", () => {
    const unnamed = addPackage(
      "node_modules/unnamed",
      { name: "unnamed", version: "1.0.0" },
      { LICENSE: "some terms" },
    );
    const { problems } = run(metafileOf([unnamed]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'unnamed@1.0.0 is bundled and ships a licence file, but its package.json declares no "license"',
    );
  });

  it("reads the older forms of the license field", () => {
    const object = addPackage("node_modules/object", {
      name: "object",
      version: "1.0.0",
      license: { type: "MIT", url: "https://example.invalid" },
    });
    const list = addPackage("node_modules/list", {
      name: "list",
      version: "1.0.0",
      licenses: [{ type: "MIT" }, { type: "GPL-2.0" }],
    });
    const { packages, problems } = run(metafileOf([object, list]));
    expect(packages.map((entry) => entry.license)).toEqual(["MIT AND GPL-2.0", "MIT"]);
    // Every licence of a list applies, so one that is not allowed fails it.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('list@1.0.0 is bundled and licensed "MIT AND GPL-2.0"');
  });
});

describe("the notices file", () => {
  it("gives each package's name, version, licence and licence text, in a stable order", () => {
    const zeta = addPackage(
      "node_modules/zeta",
      { name: "zeta", version: "2.0.0", license: "MIT" },
      { LICENSE: MIT_TEXT, NOTICE: "Portions copyright someone else" },
    );
    const alpha = addPackage("node_modules/alpha", {
      name: "alpha",
      version: "1.0.0",
      license: "ISC",
    });
    const { notices, problems } = run(metafileOf([zeta, alpha, "src/index.ts"]));
    expect(problems).toEqual([]);
    expect(notices).toContain(`Software bundled into ${SELF}`);
    expect(notices).toContain("Bundled packages (2):\n\n  alpha 1.0.0 (ISC)\n  zeta 2.0.0 (MIT)\n");
    // Line endings are normalised, and a licence and its notice both appear.
    expect(notices).toContain(
      "\nzeta 2.0.0\nLicense: MIT\n" +
        `${"-".repeat(80)}\n\n` +
        "MIT License\n\nCopyright (c) someone\n\nPortions copyright someone else\n",
    );
    // A package that ships no licence file still says which licence it declares.
    expect(notices).toContain(
      "This package ships no licence file. Its package.json declares the licence as ISC.",
    );
    expect(notices).not.toContain("\r");
    expect(notices.indexOf("\nalpha 1.0.0\n")).toBeLessThan(notices.indexOf("\nzeta 2.0.0\n"));
    // The same bundle gives the same file: nothing in it depends on when it was built.
    expect(run(metafileOf(["src/index.ts", alpha, zeta])).notices).toBe(notices);
  });
});

describe("what the bundle may need at run time", () => {
  const mit = (name: string) =>
    addPackage(`node_modules/${name}`, { name, version: "1.0.0", license: "MIT" });

  it("allows Node built-ins and create-avalanche-app", () => {
    const { problems } = run(
      metafileOf(
        [mit("lib")],
        [
          { path: "fs", kind: "import-statement", external: true },
          { path: "node:path", kind: "import-statement", external: true },
          { path: "create-avalanche-app/api", kind: "import-statement", external: true },
          { path: "create-avalanche-app", kind: "dynamic-import", external: true },
          // Not external: a chunk of the bundle itself.
          { path: "dist/chunk.js", kind: "import-statement" },
        ],
      ),
    );
    expect(problems).toEqual([]);
  });

  it("fails on an import that was left for run time, naming it once", () => {
    const { problems } = run(
      metafileOf(
        [mit("lib")],
        [
          { path: "viem", kind: "import-statement", external: true },
          { path: "viem", kind: "import-statement", external: true },
          { path: "create-avalanche-app-extra", kind: "import-statement", external: true },
        ],
      ),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('The bundle imports "viem" at run time');
    expect(problems[0]).toContain("only depends on create-avalanche-app");
    expect(problems[1]).toContain('"create-avalanche-app-extra"');
  });

  it("fails on a require left in bundled CommonJS, which an ES module cannot run", () => {
    const { problems } = run(
      metafileOf(
        [mit("lib")],
        [
          { path: "node:crypto", kind: "require-call", external: true },
          { path: "bufferutil", kind: "require-call", external: true },
        ],
      ),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('require("node:crypto")');
    expect(problems[0]).toContain("createRequire(import.meta.url)");
    expect(problems[1]).toContain('require("bufferutil")');
  });

  it("fails when a transport the stdio server never uses is bundled", () => {
    const { problems } = run(metafileOf([mit("lib"), mit("ws"), mit("express")]));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("express is in the bundle");
    expect(problems[1]).toContain("ws is in the bundle");
  });
});
