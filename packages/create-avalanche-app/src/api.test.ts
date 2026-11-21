import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AVAKIT_CORE_VERSION,
  AVAKIT_REACT_VERSION,
  assertChainSupported,
  assertSafeProjectName,
  experimentalWarning,
  isChainId,
  listTemplates,
  scaffoldApp,
} from "./api.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The current version of a sibling package (`core` or `react`) in this repo. */
const readVersion = (pkg: string) =>
  (
    JSON.parse(readFileSync(path.join(here, "..", "..", pkg, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

const scaffoldedPackage = (target: string) =>
  JSON.parse(readFileSync(path.join(target, "package.json"), "utf8")) as {
    name: string;
    dependencies: Record<string, string>;
  };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "caa-api-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("assertSafeProjectName", () => {
  it("accepts ordinary project names", () => {
    for (const name of ["my-avax-app", "app.v2", "App123", "a", "my_app"]) {
      expect(() => assertSafeProjectName(name)).not.toThrow();
    }
  });

  it("rejects traversal, absolute paths, separators, and dotfiles", () => {
    for (const name of [
      "",
      "..",
      "../evil",
      "foo/../bar",
      "/etc/passwd",
      "a/b",
      "a\\b",
      "C:\\Windows",
      ".env",
      ".ssh",
      "bad name",
      "trailing.",
      "a".repeat(65),
    ]) {
      expect(() => assertSafeProjectName(name), name).toThrow();
    }
  });
});

describe("template chains", () => {
  it("lists the chains each shipped template supports", () => {
    // Deliberately spelled out: moving a template onto mainnet is a decision,
    // and it should take a change here (and in the README matrix) to make it.
    const chains = Object.fromEntries(listTemplates().map((t) => [t.id, t.chains]));
    expect(chains).toEqual({
      minimal: ["fuji", "c-chain"],
      "nft-mint": ["fuji"],
      "token-gated-app": ["fuji"],
      "erc20-token": ["fuji"],
      "eerc-token": ["fuji"],
      "icm-messenger": ["fuji"],
      "l1-launch": ["fuji"],
      "token-bridge": ["fuji"],
    });
  });

  it("treats a manifest with no usable chains as Fuji only", () => {
    const manifests: Record<string, object | null> = {
      "no-manifest": null,
      "no-key": { title: "No key" },
      empty: { chains: [] },
      misspelt: { chains: ["mainnet", "C-Chain"] },
      "not-a-list": { chains: "c-chain" },
      mainnet: { chains: ["c-chain"] },
      both: { chains: ["c-chain", "fuji", "c-chain"] },
    };
    for (const [id, manifest] of Object.entries(manifests)) {
      mkdirSync(path.join(dir, id));
      if (manifest) writeFileSync(path.join(dir, id, "manifest.json"), JSON.stringify(manifest));
    }
    const chains = Object.fromEntries(listTemplates(dir).map((t) => [t.id, t.chains]));
    expect(chains).toEqual({
      "no-manifest": ["fuji"],
      "no-key": ["fuji"],
      empty: ["fuji"],
      misspelt: ["fuji"],
      "not-a-list": ["fuji"],
      mainnet: ["c-chain"],
      both: ["fuji", "c-chain"],
    });
  });

  it("recognises exactly the known chain ids", () => {
    expect(isChainId("fuji")).toBe(true);
    expect(isChainId("c-chain")).toBe(true);
    for (const other of ["mainnet", "cChain", "Fuji", "", undefined, 43114]) {
      expect(isChainId(other), String(other)).toBe(false);
    }
  });

  it("refuses a chain the template does not list, naming the ones it does", () => {
    const nft = { id: "nft-mint", chains: ["fuji" as const] };
    expect(() => assertChainSupported(nft, "fuji")).not.toThrow();
    expect(() => assertChainSupported(nft, "c-chain")).toThrow(
      'Template "nft-mint" cannot be scaffolded for chain "c-chain". It supports: fuji.',
    );
    expect(() => assertChainSupported(nft, "mainnet")).toThrow(/It supports: fuji\./);
  });
});

describe("template status", () => {
  it("marks exactly the three templates that need Avalanche CLI as experimental", () => {
    // Spelled out, like the chains: making a template experimental, or taking
    // the label off again, is a decision that should take a change here.
    const status = Object.fromEntries(listTemplates().map((t) => [t.id, t.status]));
    expect(status).toEqual({
      minimal: "stable",
      "nft-mint": "stable",
      "token-gated-app": "stable",
      "erc20-token": "stable",
      "eerc-token": "stable",
      "icm-messenger": "experimental",
      "l1-launch": "experimental",
      "token-bridge": "experimental",
    });
  });

  it("gives every experimental template a reason that names Avalanche CLI and the last full run", () => {
    for (const template of listTemplates().filter((t) => t.status === "experimental")) {
      expect(template.statusReason, template.id).toBe(
        "It needs Avalanche CLI, which has been in maintenance mode since December 2025, " +
          "and was last proven end to end in July 2026.",
      );
    }
    for (const template of listTemplates().filter((t) => t.status === "stable")) {
      expect(template, template.id).not.toHaveProperty("statusReason");
    }
  });

  it("reads a manifest's status in the direction that warns", () => {
    const manifests: Record<string, object | null> = {
      "no-manifest": null,
      "no-key": { title: "No key" },
      stable: { status: "stable", statusReason: "Ignored on a stable template." },
      experimental: { status: "experimental", statusReason: "  Needs a tool.  " },
      "no-reason": { status: "experimental" },
      "blank-reason": { status: "experimental", statusReason: "   " },
      misspelt: { status: "experimantal", statusReason: "Typo." },
      "not-a-string": { status: true },
      "reason-not-a-string": { status: "experimental", statusReason: 42 },
    };
    for (const [id, manifest] of Object.entries(manifests)) {
      mkdirSync(path.join(dir, id));
      if (manifest) writeFileSync(path.join(dir, id, "manifest.json"), JSON.stringify(manifest));
    }
    const read = Object.fromEntries(
      listTemplates(dir).map((t) => [t.id, { status: t.status, statusReason: t.statusReason }]),
    );
    expect(read).toEqual({
      "no-manifest": { status: "stable", statusReason: undefined },
      "no-key": { status: "stable", statusReason: undefined },
      stable: { status: "stable", statusReason: undefined },
      experimental: { status: "experimental", statusReason: "Needs a tool." },
      "no-reason": { status: "experimental", statusReason: undefined },
      "blank-reason": { status: "experimental", statusReason: undefined },
      misspelt: { status: "experimental", statusReason: "Typo." },
      "not-a-string": { status: "experimental", statusReason: undefined },
      "reason-not-a-string": { status: "experimental", statusReason: undefined },
    });
  });

  it("words the warning for an experimental template, and has none for a stable one", () => {
    expect(experimentalWarning({ id: "minimal", status: "stable" })).toBeNull();
    expect(
      experimentalWarning({ id: "x", status: "stable", statusReason: "Never shown." }),
    ).toBeNull();
    expect(experimentalWarning({ id: "x", status: "experimental" })).toBe(
      'Template "x" is experimental.',
    );
    const bridge = listTemplates().find((t) => t.id === "token-bridge");
    expect(bridge && experimentalWarning(bridge)).toBe(
      'Template "token-bridge" is experimental. It needs Avalanche CLI, which has been in ' +
        "maintenance mode since December 2025, and was last proven end to end in July 2026.",
    );
  });
});

describe("scaffoldApp", () => {
  it("refuses an unsafe projectName before touching the filesystem", async () => {
    await expect(
      scaffoldApp({ projectName: "../evil", targetDir: "/tmp/whatever", template: "minimal" }),
    ).rejects.toThrow(/Invalid project name/);
  });

  it("refuses an unknown template, including one that points outside templates/", async () => {
    for (const template of ["nft", "../dist", ".", "minimal/app", ""]) {
      const target = path.join(dir, "app");
      await expect(
        scaffoldApp({ projectName: "app", targetDir: target, template }),
        template,
      ).rejects.toThrow(/Unknown template/);
      expect(existsSync(target)).toBe(false);
    }
  });

  it("refuses C-Chain for every template that is Fuji-only, before writing anything", async () => {
    const fujiOnly = listTemplates().filter((t) => !t.chains.includes("c-chain"));
    expect(fujiOnly.length).toBeGreaterThan(0);
    for (const template of fujiOnly) {
      const target = path.join(dir, template.id);
      await expect(
        scaffoldApp({
          projectName: "app",
          targetDir: target,
          template: template.id,
          chain: "c-chain",
        }),
        template.id,
      ).rejects.toThrow(
        `Template "${template.id}" cannot be scaffolded for chain "c-chain". It supports: fuji.`,
      );
      expect(existsSync(target), template.id).toBe(false);
    }
  });

  it("refuses a chain it does not know rather than falling back to Fuji", async () => {
    const target = path.join(dir, "app");
    await expect(
      scaffoldApp({
        projectName: "app",
        targetDir: target,
        template: "minimal",
        // What an untyped caller (plain JS, a tool call) can still pass.
        chain: "mainnet" as never,
      }),
    ).rejects.toThrow(/cannot be scaffolded for chain "mainnet"/);
    expect(existsSync(target)).toBe(false);
  });

  it("scaffolds the minimal template for either chain it lists", async () => {
    const providers = async (chain?: "fuji" | "c-chain") => {
      const target = path.join(dir, chain ?? "default");
      await scaffoldApp({
        projectName: "app",
        targetDir: target,
        template: "minimal",
        ...(chain ? { chain } : {}),
      });
      return readFileSync(path.join(target, "app", "providers.tsx"), "utf8");
    };
    expect(await providers()).toContain("chains={[fuji]}");
    expect(await providers("fuji")).toContain("chains={[fuji]}");
    expect(await providers("c-chain")).toContain("chains={[cChain]}");
  });
});

describe("scaffoldApp version pins", () => {
  it("pins @avakit/core and @avakit/react each from its OWN package's version", async () => {
    // Core and react version independently, so a single shared number cannot pin
    // both. This asserts each pin tracks its own package — if the code ever
    // regressed to one value, and the two versions differed, this fails.
    expect(AVAKIT_CORE_VERSION).toBe(readVersion("core"));
    expect(AVAKIT_REACT_VERSION).toBe(readVersion("react"));

    const target = path.join(dir, "app");
    await scaffoldApp({ projectName: "app", targetDir: target, template: "minimal" });

    const deps = scaffoldedPackage(target).dependencies;
    expect(deps["@avakit/core"]).toBe(`^${readVersion("core")}`);
    expect(deps["@avakit/react"]).toBe(`^${readVersion("react")}`);
  });

  it("pins every template the same way", async () => {
    for (const template of listTemplates()) {
      const target = path.join(dir, template.id);
      await scaffoldApp({ projectName: "app", targetDir: target, template: template.id });
      const deps = scaffoldedPackage(target).dependencies;
      expect(deps["@avakit/core"], template.id).toBe(`^${readVersion("core")}`);
      expect(deps["@avakit/react"], template.id).toBe(`^${readVersion("react")}`);
    }
  });

  it("links via workspace when local", async () => {
    const target = path.join(dir, "app");
    await scaffoldApp({ projectName: "app", targetDir: target, template: "minimal", local: true });

    const deps = scaffoldedPackage(target).dependencies;
    expect(deps["@avakit/core"]).toBe("workspace:*");
    expect(deps["@avakit/react"]).toBe("workspace:*");
  });

  it("always installs @web3auth/modal, since every template wires the social adapter", async () => {
    for (const template of listTemplates()) {
      const target = path.join(dir, template.id);
      await scaffoldApp({ projectName: "app", targetDir: target, template: template.id });
      const deps = scaffoldedPackage(target).dependencies;
      // An exact version, not a range: this SDK is pinned on purpose.
      expect(deps["@web3auth/modal"], template.id).toMatch(/^\d+\.\d+\.\d+$/);
      // Inserted in place, so the dependency list stays sorted.
      expect(Object.keys(deps), template.id).toEqual(
        [...Object.keys(deps)].sort((a, b) => a.localeCompare(b)),
      );
    }
  });
});

describe("scaffoldApp output", () => {
  it("restores the dot-files that cannot ship under their real names", async () => {
    // npm will not publish a literal `.gitignore`, so templates carry these
    // without the dot and the scaffolder puts it back.
    for (const template of listTemplates()) {
      const target = path.join(dir, template.id);
      await scaffoldApp({ projectName: "app", targetDir: target, template: template.id });
      for (const restored of [".gitignore", ".env.example", ".npmrc", ".cursor/rules/avakit.mdc"]) {
        expect(existsSync(path.join(target, restored)), `${template.id} ${restored}`).toBe(true);
      }
      for (const undotted of ["gitignore", "env.example", "npmrc", "cursor"]) {
        expect(existsSync(path.join(target, undotted)), `${template.id} ${undotted}`).toBe(false);
      }
    }
  });

  it("gives every app the .npmrc that lets npm 10 install it", async () => {
    // @web3auth/modal, which every app gets, depends on vitest, and the peer set
    // that pulls in stops npm 10 (Node.js 22's npm) with "Cannot read properties
    // of null (reading 'edgesOut')" unless peer resolution is left out.
    for (const template of listTemplates()) {
      const target = path.join(dir, `${template.id}-npmrc`);
      await scaffoldApp({ projectName: "app", targetDir: target, template: template.id });
      const npmrc = readFileSync(path.join(target, ".npmrc"), "utf8");
      expect(npmrc, template.id).toMatch(/^legacy-peer-deps=true$/m);
    }
  });

  it("keeps the template's manifest out of the generated app", async () => {
    const target = path.join(dir, "app");
    const { files } = await scaffoldApp({
      projectName: "app",
      targetDir: target,
      template: "nft-mint",
    });
    expect(existsSync(path.join(target, "manifest.json"))).toBe(false);
    expect(files).not.toContain("manifest.json");
  });

  it("fills in every placeholder in every file of every template", async () => {
    for (const template of listTemplates()) {
      const target = path.join(dir, template.id);
      const { files } = await scaffoldApp({
        projectName: "my-avax-app",
        targetDir: target,
        template: template.id,
      });
      for (const file of files) {
        const content = readFileSync(path.join(target, file), "utf8");
        // Every placeholder is `__UPPER_CASE__`; none may survive scaffolding.
        expect(content.match(/__[A-Z][A-Z_]*[A-Z]__/g), `${template.id}/${file}`).toBeNull();
      }
      expect(scaffoldedPackage(target).name, template.id).toBe("my-avax-app");
    }
  });

  it("returns the files it wrote, relative to the target directory", async () => {
    const target = path.join(dir, "app");
    const result = await scaffoldApp({
      projectName: "app",
      targetDir: target,
      template: "minimal",
    });
    expect(result.targetDir).toBe(target);
    expect(result.files).toEqual(
      expect.arrayContaining([
        "package.json",
        ".gitignore",
        ".env.example",
        path.join("app", "providers.tsx"),
        path.join(".cursor", "rules", "avakit.mdc"),
      ]),
    );
    for (const file of result.files) {
      expect(path.isAbsolute(file), file).toBe(false);
      expect(existsSync(path.join(target, file)), file).toBe(true);
    }
  });
});
