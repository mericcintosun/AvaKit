import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AVAKIT_CORE_VERSION, AVAKIT_REACT_VERSION, scaffoldApp } from "./api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const readVersion = (pkg: string) =>
  (
    JSON.parse(readFileSync(path.join(here, "..", "..", pkg, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

const scaffolded = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("scaffoldApp version pins", () => {
  it("pins @avakit/core and @avakit/react each from its OWN package's version", async () => {
    // The trap A2 guards: core and react version independently, so a single
    // shared number can't pin both. This asserts each pin tracks its own
    // package — if the code ever regressed to one value, and the two versions
    // differed, this fails.
    expect(AVAKIT_CORE_VERSION).toBe(readVersion("core"));
    expect(AVAKIT_REACT_VERSION).toBe(readVersion("react"));

    dir = mkdtempSync(path.join(tmpdir(), "caa-"));
    const target = path.join(dir, "app");
    await scaffoldApp({ projectName: "app", targetDir: target, template: "minimal" });

    const deps = scaffolded(target).dependencies;
    expect(deps["@avakit/core"]).toBe(`^${readVersion("core")}`);
    expect(deps["@avakit/react"]).toBe(`^${readVersion("react")}`);
  });

  it("links via workspace when local", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "caa-"));
    const target = path.join(dir, "app");
    await scaffoldApp({ projectName: "app", targetDir: target, template: "minimal", local: true });

    const deps = scaffolded(target).dependencies;
    expect(deps["@avakit/core"]).toBe("workspace:*");
    expect(deps["@avakit/react"]).toBe("workspace:*");
  });

  it("always installs @web3auth/modal, since every template wires the social adapter", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "caa-"));
    const target = path.join(dir, "app");
    await scaffoldApp({ projectName: "app", targetDir: target, template: "minimal" });

    expect(scaffolded(target).dependencies["@web3auth/modal"]).toBeDefined();
  });
});
