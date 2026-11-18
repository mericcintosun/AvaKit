import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { cChain, fuji } from "@avakit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADDRESS_RE,
  assertMainnetAllowed,
  BYTECODE_RE,
  insideWorkspace,
  mainnetOpenedByOperator,
  resolveScaffoldTarget,
  resolveWorkspace,
} from "./guards.js";

describe("assertMainnetAllowed", () => {
  const original = process.env.AVAKIT_ALLOW_MAINNET;
  afterEach(() => {
    if (original === undefined) delete process.env.AVAKIT_ALLOW_MAINNET;
    else process.env.AVAKIT_ALLOW_MAINNET = original;
  });

  it("allows any testnet deploy regardless of confirm or env", () => {
    delete process.env.AVAKIT_ALLOW_MAINNET;
    expect(() => assertMainnetAllowed(fuji, undefined)).not.toThrow();
    expect(() => assertMainnetAllowed(fuji, false)).not.toThrow();
  });

  it("rejects mainnet without confirm", () => {
    process.env.AVAKIT_ALLOW_MAINNET = "1";
    expect(() => assertMainnetAllowed(cChain, undefined)).toThrow(/without confirm/);
    expect(() => assertMainnetAllowed(cChain, false)).toThrow(/without confirm/);
  });

  it("rejects mainnet with confirm but no env opt-in (prompt cannot set env)", () => {
    delete process.env.AVAKIT_ALLOW_MAINNET;
    expect(() => assertMainnetAllowed(cChain, true)).toThrow(/AVAKIT_ALLOW_MAINNET/);
  });

  it("allows mainnet only with BOTH confirm and the env opt-in", () => {
    process.env.AVAKIT_ALLOW_MAINNET = "1";
    expect(() => assertMainnetAllowed(cChain, true)).not.toThrow();
  });

  it("holds a contract call to the same two gates as a deploy, and words the refusal for it", () => {
    delete process.env.AVAKIT_ALLOW_MAINNET;
    expect(() => assertMainnetAllowed(fuji, undefined, "send")).not.toThrow();
    expect(() => assertMainnetAllowed(cChain, undefined, "send")).toThrow(
      "Refusing to send a transaction on Avalanche C-Chain (mainnet) without confirm:true.",
    );
    expect(() => assertMainnetAllowed(cChain, true, "send")).toThrow(
      "Refusing to send a transaction on Avalanche C-Chain (mainnet): set AVAKIT_ALLOW_MAINNET=1 in the " +
        "server environment to allow mainnet transactions. This out-of-band gate cannot be set by a tool caller.",
    );
    process.env.AVAKIT_ALLOW_MAINNET = "1";
    expect(() => assertMainnetAllowed(cChain, false, "send")).toThrow(/without confirm:true/);
    expect(() => assertMainnetAllowed(cChain, true, "send")).not.toThrow();

    // The wording a deploy has always been refused with is unchanged.
    delete process.env.AVAKIT_ALLOW_MAINNET;
    expect(() => assertMainnetAllowed(cChain, true)).toThrow(
      "Refusing to deploy to Avalanche C-Chain (mainnet): set AVAKIT_ALLOW_MAINNET=1 in the " +
        "server environment to allow mainnet deploys. This out-of-band gate cannot be set by a tool caller.",
    );
  });

  it("opens the environment's half of the gate for exactly one value", () => {
    expect(mainnetOpenedByOperator({ AVAKIT_ALLOW_MAINNET: "1" })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", " 1", "01"]) {
      expect(mainnetOpenedByOperator({ AVAKIT_ALLOW_MAINNET: value }), String(value)).toBe(false);
    }
  });
});

describe("BYTECODE_RE", () => {
  it("accepts 0x-prefixed and bare hex", () => {
    expect(BYTECODE_RE.test("0x60806040")).toBe(true);
    expect(BYTECODE_RE.test("60806040")).toBe(true);
  });

  it("rejects empty, non-hex, and whitespace", () => {
    for (const bad of ["", "0x", "0xzz", "hello", "0x60 60", "0x60\n"]) {
      expect(BYTECODE_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("ADDRESS_RE", () => {
  it("accepts twenty bytes of hex and nothing else", () => {
    expect(ADDRESS_RE.test(`0x${"aB".repeat(20)}`)).toBe(true);
    for (const bad of ["", "0x", `0x${"ab".repeat(19)}`, `0x${"ab".repeat(21)}`, "ab".repeat(20)]) {
      expect(ADDRESS_RE.test(bad), bad).toBe(false);
    }
    expect(ADDRESS_RE.test(`0x${"zz".repeat(20)}`)).toBe(false);
    expect(ADDRESS_RE.test(`0x${"ab".repeat(20)}\n`)).toBe(false);
  });
});

describe("the workspace", () => {
  let base: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-workspace-")));
    mkdirSync(path.join(base, "work"));
    mkdirSync(path.join(base, "elsewhere"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("is the working directory, or the directory AVAKIT_MCP_ROOT names", () => {
    const cwd = path.join(base, "work");
    expect(resolveWorkspace(cwd, {})).toEqual({ root: cwd, realRoot: cwd, unconstrained: false });
    // Relative to the working directory when it is not absolute.
    expect(resolveWorkspace(cwd, { AVAKIT_MCP_ROOT: "../elsewhere" }).root).toBe(
      path.join(base, "elsewhere"),
    );
    expect(resolveWorkspace(cwd, { AVAKIT_MCP_ROOT: " " }).root).toBe(cwd);
  });

  it("constrains nothing when it is the filesystem root, unless the environment says so on purpose", () => {
    const fsRoot = path.parse(base).root;
    expect(resolveWorkspace(fsRoot, {}).unconstrained).toBe(true);
    expect(resolveWorkspace(fsRoot, { AVAKIT_MCP_ROOT: fsRoot }).unconstrained).toBe(false);
    expect(resolveWorkspace(fsRoot, { AVAKIT_MCP_ROOT: base }).unconstrained).toBe(false);
  });

  it("tells what is inside it from what is not, and gives back the real path", () => {
    const workspace = resolveWorkspace(path.join(base, "work"), {});
    expect(insideWorkspace(workspace, path.join(base, "work", "a", "b.json"))).toBe(
      path.join(base, "work", "a", "b.json"),
    );
    expect(insideWorkspace(workspace, path.join(base, "work"))).toBe(path.join(base, "work"));
    for (const outside of [base, path.join(base, "elsewhere"), path.join(base, "work-other")]) {
      expect(insideWorkspace(workspace, outside), outside).toBeUndefined();
    }
  });
});

describe("resolveScaffoldTarget", () => {
  // <base>/work is the server's working directory; <base>/outside is not.
  let base: string;
  let cwd: string;
  let outside: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-")));
    cwd = path.join(base, "work");
    outside = path.join(base, "outside");
    mkdirSync(cwd);
    mkdirSync(outside);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const target = (name: string, directory?: string, env: NodeJS.ProcessEnv = {}) =>
    resolveScaffoldTarget(name, directory, cwd, env);

  it("creates the project in the working directory by default", () => {
    expect(target("app")).toBe(path.join(cwd, "app"));
  });

  it("accepts a parent directory inside the working directory", () => {
    expect(target("app", "apps")).toBe(path.join(cwd, "apps", "app"));
    expect(target("app", ".")).toBe(path.join(cwd, "app"));
    expect(target("app", "not/created/yet")).toBe(path.join(cwd, "not", "created", "yet", "app"));
    expect(target("app", path.join(cwd, "absolute"))).toBe(path.join(cwd, "absolute", "app"));
    expect(target("app", "apps/../packages")).toBe(path.join(cwd, "packages", "app"));
    // Two dots at the start of a name are not a step up.
    expect(target("app", "..dotted")).toBe(path.join(cwd, "..dotted", "app"));
  });

  it("refuses a parent directory outside the working directory", () => {
    const escapes = [
      "..",
      "../outside",
      "../..",
      "apps/../..",
      // The path a review got a project planted with, before this check.
      "../outside/deep/../..",
      outside,
      base,
      homedir(),
      path.parse(cwd).root,
      // A sibling whose name merely starts like the working directory's.
      "../work-other",
    ];
    for (const directory of escapes) {
      expect(() => target("planted", directory), directory).toThrow(
        /Refusing to scaffold into .* AVAKIT_MCP_ROOT/,
      );
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symlink that leads out of the working directory",
    () => {
      symlinkSync(outside, path.join(cwd, "shortcut"));
      expect(() => target("app", "shortcut")).toThrow(/Refusing to scaffold into/);
      expect(() => target("app", "shortcut/deeper")).toThrow(/Refusing to scaffold into/);

      // A link that stays inside is just another way to name a directory.
      mkdirSync(path.join(cwd, "real"));
      symlinkSync(path.join(cwd, "real"), path.join(cwd, "alias"));
      expect(target("app", "alias")).toBe(path.join(cwd, "alias", "app"));
    },
  );

  it("still refuses an unsafe project name", () => {
    for (const name of ["../evil", "..", "a/b", ".ssh", ""]) {
      expect(() => target(name), name).toThrow(/Invalid project name/);
    }
  });

  it("uses AVAKIT_MCP_ROOT instead of the working directory when the server sets it", () => {
    const env = { AVAKIT_MCP_ROOT: outside };
    // The root is where projects go, so a bare name lands in it …
    expect(target("app", undefined, env)).toBe(path.join(outside, "app"));
    expect(target("app", "apps", env)).toBe(path.join(outside, "apps", "app"));
    // … and it replaces the working directory rather than adding to it.
    expect(() => target("app", cwd, env)).toThrow(/Refusing to scaffold into/);
    expect(() => target("app", "..", env)).toThrow(/Refusing to scaffold into/);
  });

  it("can be opened up to a whole tree, but only from the server's environment", () => {
    const env = { AVAKIT_MCP_ROOT: base };
    expect(target("app", outside, env)).toBe(path.join(outside, "app"));
    expect(target("app", cwd, env)).toBe(path.join(cwd, "app"));
  });

  it("refuses to treat the filesystem root as the place for projects", () => {
    // Claude Desktop on macOS starts its servers in "/". Every path on the disk is
    // inside that, so the containment check on its own let any directory through.
    const fsRoot = path.parse(cwd).root;
    const fromRoot = (directory?: string, env: NodeJS.ProcessEnv = {}) =>
      resolveScaffoldTarget("planted", directory, fsRoot, env);

    for (const directory of [undefined, outside, cwd, homedir(), "tmp"]) {
      expect(() => fromRoot(directory), String(directory)).toThrow(
        /not a project folder.* AVAKIT_MCP_ROOT/,
      );
    }
    // Naming a directory in the server environment is how such a client is set up …
    expect(fromRoot(undefined, { AVAKIT_MCP_ROOT: outside })).toBe(path.join(outside, "planted"));
    expect(() => fromRoot(cwd, { AVAKIT_MCP_ROOT: outside })).toThrow(/Refusing to scaffold into/);
    // … and only that can open up the whole disk, if that is really what is wanted.
    expect(fromRoot(outside, { AVAKIT_MCP_ROOT: fsRoot })).toBe(path.join(outside, "planted"));
  });

  it("treats an empty AVAKIT_MCP_ROOT as not set", () => {
    for (const value of ["", "   "]) {
      expect(target("app", undefined, { AVAKIT_MCP_ROOT: value })).toBe(path.join(cwd, "app"));
      expect(() => target("app", outside, { AVAKIT_MCP_ROOT: value })).toThrow(
        /Refusing to scaffold into/,
      );
    }
  });
});
