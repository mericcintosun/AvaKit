import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { templatesDir } from "create-avalanche-app/api";
import { encodeFunctionData } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deployableBytecode,
  deployHint,
  findArtifacts,
  MAX_ARTIFACT_BYTES,
  parseArtifact,
  readArtifact,
  resolveArtifactPath,
} from "./artifact.js";

const MINT = {
  type: "function",
  name: "mint",
  inputs: [],
  outputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
  stateMutability: "nonpayable",
};

/** A template artifact module, in the form the templates' `lib/*-artifact.ts` files have. */
const moduleSource = (abi: unknown = [MINT], bytecode = "0x6080604052") =>
  [
    "// Auto-generated from contracts/src/AvaKitNFT.sol via `forge build`.",
    "// Re-generate after editing the contract: cd contracts && forge build, then",
    "// copy abi + bytecode.object here.",
    "",
    'import type { Abi, Hex } from "viem";',
    "",
    `export const abi = ${JSON.stringify(abi, null, 2)} as const satisfies Abi;`,
    "",
    `export const bytecode = "${bytecode}" as Hex;`,
    "",
  ].join("\n");

describe("parseArtifact", () => {
  it("reads a JSON artifact with a hex string as bytecode", () => {
    const artifact = parseArtifact(JSON.stringify({ abi: [MINT], bytecode: "0x60806040" }), "a");
    expect(artifact).toEqual({ abi: [MINT], bytecode: "0x60806040" });
  });

  it("reads a Foundry artifact, where bytecode is an object", () => {
    const foundry = {
      abi: [MINT],
      bytecode: { object: "0x60806040", sourceMap: "0:1:2", linkReferences: {} },
      deployedBytecode: { object: "0x6080" },
      methodIdentifiers: { "mint()": "1249c58b" },
    };
    expect(parseArtifact(JSON.stringify(foundry), "Counter.json")).toEqual({
      abi: [MINT],
      bytecode: "0x60806040",
    });
  });

  it("reads a Hardhat artifact, and a bare-hex bytecode gets its prefix", () => {
    const hardhat = { _format: "hh-sol-artifact-1", contractName: "C", abi: [], bytecode: "6080" };
    expect(parseArtifact(JSON.stringify(hardhat), "C.json").bytecode).toBe("0x6080");
  });

  it("reads an AvaKit template artifact module without running it", () => {
    expect(parseArtifact(moduleSource(), "lib/nft-artifact.ts")).toEqual({
      abi: [MINT],
      bytecode: "0x6080604052",
    });
  });

  it("tolerates the ways such a module can be written", () => {
    const variants = [
      // A type annotation instead of `as const satisfies`.
      `export const abi: Abi = ${JSON.stringify([MINT])};\nexport const bytecode: Hex = '0x6080';`,
      // No semicolons, the value on its own line, a byte-order mark, Windows line endings.
      `﻿export const abi = ${JSON.stringify([MINT])} as const\r\n\r\nexport const bytecode =\r\n  "0x6080" as Hex\r\n`,
      // Other exports around them, and brackets inside a string.
      `export const NAME = "nft [v2]";\nexport const abi = ${JSON.stringify([
        { ...MINT, name: "weird]name[" },
      ])};\nexport const bytecode = \`0x6080\`;\nexport const other = [1, 2];`,
    ];
    for (const source of variants) {
      const artifact = parseArtifact(source, "lib/x-artifact.ts");
      expect(artifact.bytecode, source).toBe("0x6080");
      expect(artifact.abi).toHaveLength(1);
    }
  });

  it("reads every artifact module the templates ship, into something that encodes a call", () => {
    const modules = readdirSync(templatesDir).flatMap((template) => {
      const lib = path.join(templatesDir, template, "lib");
      try {
        return readdirSync(lib)
          .filter((file) => file.endsWith("-artifact.ts"))
          .map((file) => path.join(lib, file));
      } catch {
        return [];
      }
    });
    // nft-mint, token-gated-app, erc20-token, icm-messenger, l1-launch.
    expect(modules.length).toBeGreaterThanOrEqual(5);
    for (const file of modules) {
      const source = readFileSync(file, "utf8");
      const { abi, bytecode } = parseArtifact(source, file);
      expect(abi.length, file).toBeGreaterThan(5);
      // The very string in the file, whole: about fifteen thousand hex characters for the NFT.
      expect(bytecode, file).toMatch(/^0x[0-9a-f]{1000,}$/);
      expect(source).toContain(`"${bytecode}"`);
    }
    const nft = parseArtifact(
      readFileSync(path.join(templatesDir, "nft-mint", "lib", "nft-artifact.ts"), "utf8"),
      "nft",
    );
    // Whole creation code, not a fragment: thousands of hex characters.
    expect(nft.bytecode).toMatch(/^0x[0-9a-f]{4000,}$/i);
    expect(encodeFunctionData({ abi: nft.abi, functionName: "mint" })).toBe("0x1249c58b");
  });

  it("accepts an artifact that has an ABI and nothing to deploy, but will not deploy it", () => {
    const sources = [
      JSON.stringify({ abi: [MINT] }),
      // What Foundry writes for an interface.
      JSON.stringify({ abi: [MINT], bytecode: { object: "0x" } }),
      `export const abi = ${JSON.stringify([MINT])};`,
    ];
    for (const source of sources) {
      const artifact = parseArtifact(source, "IThing");
      expect(artifact).toEqual({ abi: [MINT], bytecode: null });
      expect(() => deployableBytecode(artifact, "out/IThing.json")).toThrow(
        '"out/IThing.json" has an ABI but no creation bytecode, so there is nothing to deploy',
      );
    }
  });

  it("refuses any other shape, naming the two it accepts", () => {
    const others: [string, RegExp][] = [
      ["", /it has no `export const abi/],
      ["hello", /it has no `export const abi/],
      ['{"name": "my-app", "version": "1.0.0"}', /it has no "abi" array/],
      ['{"abi": {}}', /it has no "abi" array/],
      ["[]", /it has no `export const abi/],
      ['{"abi": [], "bytecode": 5}', /its "bytecode" is not a hex string/],
      ['{"abi": [], "bytecode": "0xzz"}', /its bytecode is not plain hex/],
      // A Foundry artifact that still needs a library linked in.
      [
        '{"abi": [], "bytecode": {"object": "0x6080__$abcdef0123456789abcdef0123456789ab$__6080"}}',
        /unlinked libraries/,
      ],
      ['{"abi": [5]}', /its "abi" is not a valid ABI/],
      ['{"abi": ["function mint() returnz (uint256)"]}', /its "abi" is not a valid ABI/],
      ["{ not json", /it is not valid JSON/],
      // The bridge template's file: several contracts keyed by name.
      ['{"DemoToken": {"abi": [], "bytecode": "0x60"}}', /it has no "abi" array/],
      [
        'export const abi = [ { type: "function", name: "mint", }, ];',
        /not in the compiler's JSON form/,
      ],
      ['export const abi = [];\nexport const bytecode = "0x60" + "80";', /not a single hex string/],
      ["export const abi = [];\nexport const bytecode = BYTECODE;", /not a single hex string/],
      ["export const abi = [", /it has no `export const abi/],
    ];
    for (const [source, why] of others) {
      expect(() => parseArtifact(source, "the/file"), source).toThrow(why);
      expect(() => parseArtifact(source, "the/file"), source).toThrow(
        /^"the\/file" is not a contract artifact this server can read: .* Two shapes are accepted: \(1\) a JSON file with "abi" and "bytecode".*\(2\) an AvaKit template artifact module such as lib\/nft-artifact\.ts/,
      );
    }
  });

  it("never quotes a file's contents back, whatever it holds", () => {
    // An agent told to "deploy" .env.local must not get the file handed back in
    // an error message. JSON.parse's own message quotes the text it failed on.
    const secret = "SUPERSECRETVALUE1234567890";
    const files = [
      `WEB3AUTH_SECRET=${secret}\nOTHER=1\n`,
      `{"token": "${secret}"`,
      `{"abi": "${secret}"}`,
      `{"abi": ["${secret}"]}`,
      `{"abi": [{"type": "function", "name": "${secret}", "inputs": [{}]}]}`,
      `{"abi": [], "bytecode": "${secret}"}`,
      `export const abi = [${secret}];`,
      `export const abi = [];\nexport const bytecode = "${secret}";`,
    ];
    for (const source of files) {
      let message = "";
      try {
        parseArtifact(source, ".env.local");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, source).toContain("is not a contract artifact");
      expect(message, source).not.toContain(secret);
      expect(message, source).not.toContain(secret.slice(0, 8));
    }
  });

  it("takes linear time on a file built to make the declaration search backtrack", () => {
    // A file just under the size cap, full of declarations that never reach an `=`.
    // With an unbounded type annotation in the search this took over two minutes,
    // during which the server answered nothing.
    const filler = (name: string) =>
      `;export const ${name}:`.repeat(Math.floor((MAX_ARTIFACT_BYTES - 200) / (16 + name.length)));
    const noAbi = filler("abi");
    expect(noAbi.length).toBeGreaterThan(MAX_ARTIFACT_BYTES * 0.9);
    let started = performance.now();
    expect(() => parseArtifact(noAbi, "lib/x-artifact.ts")).toThrow("export const abi");
    expect(performance.now() - started).toBeLessThan(2000);

    // The same for the bytecode search, which runs once the ABI has been found.
    const noBytecode = `export const abi = ${JSON.stringify([MINT])};\n${filler("bytecode")}`;
    started = performance.now();
    expect(() => parseArtifact(noBytecode, "lib/x-artifact.ts")).toThrow(
      "its `bytecode` export is not a single hex string",
    );
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("does not run the file", () => {
    const flag = "__avakit_artifact_was_evaluated__";
    const source = `globalThis.${flag} = true;\nexport const abi = (() => { globalThis.${flag} = true; return []; })();\nexport const bytecode = "0x60";`;
    expect(() => parseArtifact(source, "evil.ts")).toThrow(/is not a contract artifact/);
    expect(flag in globalThis).toBe(false);
  });
});

describe("reading an artifact by path", () => {
  // <base>/work is the server's working directory; <base>/outside is not.
  let base: string;
  let cwd: string;
  let outside: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-artifact-")));
    cwd = path.join(base, "work");
    outside = path.join(base, "outside");
    mkdirSync(path.join(cwd, "app", "lib"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(cwd, "app", "lib", "nft-artifact.ts"), moduleSource());
    writeFileSync(
      path.join(outside, "artifact.json"),
      JSON.stringify({ abi: [], bytecode: "0x60" }),
    );
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const read = (artifactPath: string, env: NodeJS.ProcessEnv = {}) =>
    readArtifact(artifactPath, cwd, env);

  it("reads a file inside the working directory, by relative or absolute path", () => {
    const expected = { abi: [MINT], bytecode: "0x6080604052" };
    expect(read("app/lib/nft-artifact.ts")).toEqual(expected);
    expect(read("./app/../app/lib/nft-artifact.ts")).toEqual(expected);
    expect(read(path.join(cwd, "app", "lib", "nft-artifact.ts"))).toEqual(expected);
  });

  it("refuses a path outside the working directory", () => {
    const escapes = [
      "../outside/artifact.json",
      "app/../../outside/artifact.json",
      path.join(outside, "artifact.json"),
      path.join(homedir(), ".ssh", "id_rsa"),
      "/etc/passwd",
      "..",
      // A sibling whose name merely starts like the working directory's.
      "../work-other/artifact.json",
      "app/lib/\0/../../../../outside/artifact.json",
    ];
    for (const artifactPath of escapes) {
      expect(() => read(artifactPath), artifactPath).toThrow(
        /^Refusing to read ".*": it is outside ".*work", the only directory this server reads contract artifacts from\. .* AVAKIT_MCP_ROOT/s,
      );
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symlink that leads out of the working directory",
    () => {
      symlinkSync(path.join(outside, "artifact.json"), path.join(cwd, "linked.json"));
      symlinkSync(outside, path.join(cwd, "shortcut"));
      expect(() => read("linked.json")).toThrow(/Refusing to read "linked.json"/);
      expect(() => read("shortcut/artifact.json")).toThrow(/Refusing to read/);

      // A link that stays inside is just another name for the file.
      symlinkSync(path.join(cwd, "app", "lib"), path.join(cwd, "alias"));
      expect(read("alias/nft-artifact.ts").bytecode).toBe("0x6080604052");
    },
  );

  it("uses AVAKIT_MCP_ROOT instead of the working directory when the server sets it", () => {
    const env = { AVAKIT_MCP_ROOT: outside };
    // Relative paths are relative to that root, as scaffold_app's are …
    expect(read("artifact.json", env).bytecode).toBe("0x60");
    // … and it replaces the working directory rather than adding to it.
    expect(() => read(path.join(cwd, "app", "lib", "nft-artifact.ts"), env)).toThrow(
      /Refusing to read/,
    );
  });

  it("has nowhere to read from when the server was started in the filesystem root", () => {
    // Everything on the disk is inside "/", so there the check constrains nothing.
    const fsRoot = path.parse(cwd).root;
    const file = path.join(cwd, "app", "lib", "nft-artifact.ts");
    expect(() => readArtifact(file, fsRoot, {})).toThrow(
      /^Refusing to read ".*": this server was started in ".*", which is not a project folder.* AVAKIT_MCP_ROOT .* or pass abi and bytecode instead\.$/,
    );
    expect(readArtifact(file, fsRoot, { AVAKIT_MCP_ROOT: cwd }).bytecode).toBe("0x6080604052");
  });

  it("refuses a file over 2 MB", () => {
    const big = path.join(cwd, "big.json");
    writeFileSync(big, JSON.stringify({ abi: [], bytecode: `0x${"60".repeat(1_100_000)}` }));
    expect(() => read("big.json")).toThrow(
      '"big.json" is 2.1 MB; artifact files over 2 MB are refused.',
    );

    // Exactly at the limit is still read (and then judged on its contents).
    writeFileSync(big, " ".repeat(MAX_ARTIFACT_BYTES));
    expect(() => read("big.json")).toThrow(/is not a contract artifact/);
    writeFileSync(big, " ".repeat(MAX_ARTIFACT_BYTES + 1));
    expect(() => read("big.json")).toThrow(/over 2 MB are refused/);
  });

  it("accepts regular files only", () => {
    expect(() => read("app/lib")).toThrow(
      '"app/lib" is a directory; artifactPath must name a file.',
    );
    expect(() => read(".")).toThrow(/is a directory/);
    expect(() => read("app/lib/missing.ts")).toThrow(
      'No file at "app/lib/missing.ts". Paths are relative to the server\'s working directory; ' +
        "scaffold_app returns the artifact paths of a new project as `artifacts`.",
    );
    // A path that runs through a file as if it were a directory.
    expect(() => read("app/lib/nft-artifact.ts/abi")).toThrow(/No file at/);
  });

  it("resolves to the real file, so what is checked is what is read", () => {
    expect(resolveArtifactPath("app/lib/nft-artifact.ts", cwd, {})).toBe(
      path.join(cwd, "app", "lib", "nft-artifact.ts"),
    );
  });
});

describe("the artifacts of a scaffolded project", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-found-")));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const project = (files: Record<string, string>) => {
    const dir = path.join(root, "apps", "my-app");
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    return findArtifacts(dir, Object.keys(files).map(path.normalize), root);
  };

  it("lists the files that really are deployable artifacts, as paths from the working directory", () => {
    const found = project({
      "package.json": "{}",
      "lib/nft-artifact.ts": moduleSource(),
      "lib/token-artifact.ts": moduleSource([], "0x60a0"),
      // Named like one, but several contracts in one file: not loadable.
      "lib/ictt-artifacts.json": JSON.stringify({ DemoToken: { abi: [], bytecode: "0x60" } }),
      // An ABI with nothing to deploy.
      "lib/interface-artifact.ts": `export const abi = ${JSON.stringify([MINT])};`,
      "lib/utils.ts": "export const abi = [];",
      "components/artifact-card.tsx": "export function ArtifactCard() { return null; }",
    });
    expect(found.map((artifact) => artifact.path)).toEqual([
      "apps/my-app/lib/nft-artifact.ts",
      "apps/my-app/lib/token-artifact.ts",
    ]);
    // Each path is one readArtifact accepts as it stands.
    for (const artifact of found) {
      expect(readArtifact(artifact.path, root, {})).toEqual(artifact.artifact);
    }
  });

  it("finds none in a project without contracts", () => {
    expect(project({ "package.json": "{}", "app/page.tsx": "export default null;" })).toEqual([]);
  });

  it("tells an agent the exact calls, and the functions there are, without a file being read", () => {
    const [nft] = project({ "lib/nft-artifact.ts": moduleSource() });
    expect(nft && deployHint(nft)).toBe(
      "From this MCP server, with no key to set up on the Fuji testnet: " +
        'deploy_contract({ artifactPath: "apps/my-app/lib/nft-artifact.ts" }), then call it with ' +
        'write_contract({ address, artifactPath: "apps/my-app/lib/nft-artifact.ts", functionName: "mint" }). ' +
        "State-changing functions: mint().",
    );

    const [messenger] = project({
      "lib/messenger-artifact.ts": moduleSource([
        { type: "constructor", inputs: [{ name: "teleporter", type: "address" }] },
        {
          type: "function",
          name: "sendMessage",
          stateMutability: "nonpayable",
          outputs: [],
          inputs: [
            { name: "destinationBlockchainID", type: "bytes32" },
            { name: "", type: "address" },
          ],
        },
      ]),
    });
    const hint = messenger ? deployHint(messenger) : "";
    expect(hint).toContain(
      'deploy_contract({ artifactPath: "apps/my-app/lib/messenger-artifact.ts", args: [teleporter] })',
    );
    expect(hint).toContain('functionName: "sendMessage", args: [destinationBlockchainID, arg1] })');
  });
});
