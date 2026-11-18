import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkNodeVersion,
  compareNodeVersions,
  ENGINES_NODE,
  nodeFloor,
  parseNodeVersion,
  TESTED_NODE_MAJORS,
} from "./preflight.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  engines: { node: string };
};

describe("parseNodeVersion", () => {
  it("reads the three numbers, with or without the leading v", () => {
    expect(parseNodeVersion("20.11.0")).toEqual([20, 11, 0]);
    expect(parseNodeVersion("v24.1.0")).toEqual([24, 1, 0]);
    expect(parseNodeVersion(" 22.0.0\n")).toEqual([22, 0, 0]);
  });

  it("ignores what follows them in a nightly or release-candidate build", () => {
    expect(parseNodeVersion("25.0.0-nightly20260101abcdef")).toEqual([25, 0, 0]);
    expect(parseNodeVersion("22.0.0-rc.1")).toEqual([22, 0, 0]);
  });

  it("gives null for anything that is not a version", () => {
    for (const value of ["", "latest", "20", "20.11", "node-20.11.0", "x.y.z"]) {
      expect(parseNodeVersion(value), value).toBeNull();
    }
  });
});

describe("compareNodeVersions", () => {
  it("compares number by number, not as text", () => {
    // As text "20.9.0" sorts after "20.11.0", and "9.0.0" after "20.0.0".
    expect(compareNodeVersions([20, 9, 0], [20, 11, 0])).toBeLessThan(0);
    expect(compareNodeVersions([9, 0, 0], [20, 0, 0])).toBeLessThan(0);
    expect(compareNodeVersions([20, 10, 9], [20, 11, 0])).toBeLessThan(0);
    expect(compareNodeVersions([20, 11, 0], [20, 11, 0])).toBe(0);
    expect(compareNodeVersions([20, 11, 1], [20, 11, 0])).toBeGreaterThan(0);
    expect(compareNodeVersions([22, 0, 0], [20, 11, 0])).toBeGreaterThan(0);
    expect(compareNodeVersions([24, 1, 0], [22, 14, 0])).toBeGreaterThan(0);
  });
});

describe("nodeFloor", () => {
  it("reads a >= range with one, two or three numbers", () => {
    expect(nodeFloor(">=20.11")).toEqual([20, 11, 0]);
    expect(nodeFloor(">= 20.11.1")).toEqual([20, 11, 1]);
    expect(nodeFloor(">=22")).toEqual([22, 0, 0]);
    expect(nodeFloor(" >=v20.11.0 ")).toEqual([20, 11, 0]);
  });

  it("gives null, rather than a guess, for a range with no single floor", () => {
    for (const range of [undefined, "", "*", "^20.11.0", "20.x", "^20.11 || >=22", ">=20.11 <25"]) {
      expect(nodeFloor(range), String(range)).toBeNull();
    }
  });

  it("understands the range this package really declares", () => {
    // If `engines.node` is ever rewritten in a form nodeFloor cannot read, the
    // check would quietly stop refusing anything. This fails instead.
    expect(ENGINES_NODE).toBe(pkg.engines.node);
    expect(nodeFloor(ENGINES_NODE)).not.toBeNull();
  });
});

describe("checkNodeVersion", () => {
  it("refuses a Node.js below the floor, naming the version found and the one required", () => {
    for (const found of ["20.10.9", "20.0.0", "18.19.1", "16.20.2", "v20.10.9"]) {
      const check = checkNodeVersion(found, ">=20.11");
      expect(check.ok, found).toBe(false);
      expect(check.message).toBe(
        `Error: create-avalanche-app needs Node.js 20.11 or newer, but this is Node.js ${found.replace("v", "")}. ` +
          "Install Node.js 22 or 24 from https://nodejs.org and run the command again.",
      );
    }
  });

  it("lets the floor itself and the rest of Node.js 20 and 21 through, with a warning", () => {
    for (const found of ["20.11.0", "20.11.1", "20.19.5", "21.7.3"]) {
      const check = checkNodeVersion(found, ">=20.11");
      expect(check.ok, found).toBe(true);
      expect(check.message).toBe(
        `Warning: this is Node.js ${found}. Node.js 20 reached end-of-life in April 2026, and ` +
          "AvaKit is tested on Node.js 22 and 24. Upgrade when you can: https://nodejs.org",
      );
    }
  });

  it("says nothing on the release lines AvaKit is tested on, or newer ones", () => {
    for (const found of ["22.0.0", "22.14.0", "23.11.0", "24.1.0", "24.21.0", "26.0.0"]) {
      expect(checkNodeVersion(found, ">=20.11"), found).toEqual({ ok: true, message: null });
    }
  });

  it("puts each message on a single line", () => {
    for (const found of ["18.19.1", "20.11.0"]) {
      expect(checkNodeVersion(found, ">=20.11").message, found).not.toContain("\n");
    }
  });

  it("states a floor with a patch number in full", () => {
    const check = checkNodeVersion("20.11.0", ">=20.11.1");
    expect(check.ok).toBe(false);
    expect(check.message).toContain("needs Node.js 20.11.1 or newer, but this is Node.js 20.11.0.");
  });

  it("enforces the floor this package declares when none is passed", () => {
    const floor = nodeFloor(pkg.engines.node);
    if (!floor) throw new Error("engines.node has no floor");
    const [major, minor, patch] = floor;
    expect(checkNodeVersion(`${major}.${minor}.${patch}`).ok).toBe(true);
    const below = minor > 0 ? `${major}.${minor - 1}.99` : `${major - 1}.99.99`;
    expect(checkNodeVersion(below).ok).toBe(false);
  });

  it("does not refuse what it cannot judge", () => {
    // A version it cannot read, or a range it cannot read: never grounds to stop.
    expect(checkNodeVersion("not-a-version", ">=20.11")).toEqual({ ok: true, message: null });
    expect(checkNodeVersion("18.19.1", "^20.11 || >=22").ok).toBe(true);
    expect(checkNodeVersion("18.19.1", "").ok).toBe(true);
  });
});

describe("what the messages claim", () => {
  it("names as tested exactly the release lines the end-to-end workflow runs on", () => {
    // "AvaKit is tested on Node.js 22 and 24" is only true while a workflow
    // really runs on both. Drop one from the matrix and this fails.
    const workflow = readFileSync(
      new URL("../../../.github/workflows/e2e-fuji.yml", import.meta.url),
      "utf8",
    );
    const nodes = [...workflow.matchAll(/^\s*node: (\d+)\s*$/gm)].map((match) => Number(match[1]));
    expect(nodes.length).toBeGreaterThan(0);
    expect([...new Set(nodes)].sort((a, b) => a - b)).toEqual([...TESTED_NODE_MAJORS]);
  });

  it("is what the README documents", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`Node.js **${TESTED_NODE_MAJORS.join(" or ")}**`);
    expect(readme).toContain(`\`engines.node\` (\`${pkg.engines.node}\`)`);
    expect(readme).toContain("Node.js 20 reached end-of-life in April 2026");
    // The table's rows are the three outcomes of the check, at the same boundaries.
    const [major, minor] = nodeFloor(pkg.engines.node) ?? [];
    expect(readme).toContain(`| ${TESTED_NODE_MAJORS[0]} or newer |`);
    expect(readme).toContain(`| ${major}.${minor} to ${TESTED_NODE_MAJORS[0] - 1} |`);
    expect(readme).toContain(`| older than ${major}.${minor} |`);
  });
});
