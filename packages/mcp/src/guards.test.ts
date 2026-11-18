import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { cChain, fuji } from "@avakit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertMainnetAllowed, BYTECODE_RE, resolveScaffoldTarget } from "./guards.js";

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
