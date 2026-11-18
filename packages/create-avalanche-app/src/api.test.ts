import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertChainSupported,
  assertSafeProjectName,
  isChainId,
  listTemplates,
  scaffoldApp,
} from "./api.js";

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
