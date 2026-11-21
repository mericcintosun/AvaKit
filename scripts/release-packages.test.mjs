import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  dependencyOrder,
  inspectTarball,
  packAll,
  packedProblems,
  packSummary,
  pendingChangesets,
  publishablePackages,
  readTarEntry,
  registryStatus,
  versionUrl,
  workspaceGlobs,
} from "./release-packages.mjs";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");

/** A throwaway directory, removed after the test. */
function tempDir(t, prefix = "avakit-release-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write `{ relative path: contents }` under `root`; objects are written as JSON. */
function writeTree(root, files) {
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(
      join(root, file),
      typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`,
    );
  }
}

/** A .tgz made by the system tar from `{ path: contents }` (paths start with package/). */
function tarball(t, files) {
  const dir = tempDir(t, "avakit-tgz-");
  writeTree(join(dir, "src"), files);
  const out = join(dir, "out.tgz");
  const result = spawnSync("tar", ["-czf", out, "-C", join(dir, "src"), "package"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(out);
}

/** A fetch that answers from `{ url: [status, body] }`, and records what was asked. */
function fakeFetch(answers) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    const [status, body] = answer ?? [404, { error: "not found" }];
    return { status, json: async () => body };
  };
  return { fetch, asked };
}

test("workspaceGlobs reads the packages list of this repository", () => {
  assert.deepEqual(workspaceGlobs(readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8")), [
    "packages/*",
    "apps/*",
    "examples/*",
  ]);
});

test("workspaceGlobs understands quoting, comments and the end of the list", () => {
  const text = [
    "# a comment",
    "packages:",
    "  - 'packages/*' # the libraries",
    "",
    "  - tools/cli",
    '  - "apps/*"',
    "catalog:",
    "  - not/a-package",
  ].join("\n");
  assert.deepEqual(workspaceGlobs(text), ["packages/*", "tools/cli", "apps/*"]);
});

test("workspaceGlobs refuses what it does not understand rather than guess", () => {
  assert.throws(() => workspaceGlobs("catalog:\n  a: 1\n"), /no top-level `packages:`/);
  assert.throws(() => workspaceGlobs("packages:\n  - 'packages/**'\n"), /not `packages\/\*\*`/);
  assert.throws(() => workspaceGlobs("packages:\n  - '!**/test/**'\n"), /only `dir` and `dir\/\*`/);
  assert.throws(() => workspaceGlobs("packages:\nother: 1\n"), /lists no packages/);
});

test("this repository publishes exactly its five packages, dependencies first", () => {
  const packages = publishablePackages(repoRoot);
  assert.deepEqual(
    packages.map((pkg) => pkg.name),
    ["@avakit/core", "create-avalanche-app", "@avakit/mcp", "@avakit/react", "@avakit/studio"],
  );
  const position = new Map(packages.map((pkg, index) => [pkg.name, index]));
  assert.ok(position.get("@avakit/core") < position.get("@avakit/react"));
  assert.ok(position.get("@avakit/core") < position.get("@avakit/studio"));
  assert.ok(position.get("create-avalanche-app") < position.get("@avakit/mcp"));
});

test("dependencyOrder puts dependencies first, keeps name order otherwise, and refuses a cycle", () => {
  const pkg = (name, dependencies = {}, extra = {}) => ({
    name,
    manifest: { dependencies, ...extra },
  });
  const ordered = dependencyOrder([
    pkg("c", { a: "workspace:*" }),
    pkg("b"),
    pkg("a", {}, { peerDependencies: { b: "workspace:^" } }),
    // A devDependency does not order the publishes.
    pkg("d", {}, { devDependencies: { e: "workspace:*" } }),
    pkg("e", {}, { devDependencies: { d: "workspace:*" } }),
  ]);
  assert.deepEqual(
    ordered.map(({ name }) => name),
    ["b", "a", "c", "d", "e"],
  );
  assert.throws(
    () => dependencyOrder([pkg("x", { y: "1" }), pkg("y", { x: "1" })]),
    /dependency cycle: x -> y -> x/,
  );
});

test("publishablePackages skips private packages and refuses a duplicate or unnamed one", (t) => {
  const root = tempDir(t);
  writeTree(root, {
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
    "packages/lib/package.json": { name: "lib", version: "1.0.0" },
    "packages/tool/package.json": {
      name: "tool",
      version: "2.0.0",
      dependencies: { lib: "workspace:*" },
    },
    "packages/not-a-package/README.md": "nothing here",
    "apps/site/package.json": { name: "site", version: "0.0.0", private: true },
  });
  assert.deepEqual(
    publishablePackages(root).map(({ name, version }) => `${name}@${version}`),
    ["lib@1.0.0", "tool@2.0.0"],
  );

  writeTree(root, { "apps/copy/package.json": { name: "lib", version: "9.9.9" } });
  assert.throws(() => publishablePackages(root), /lib is the name of both/);

  writeTree(root, { "apps/copy/package.json": { name: "nameless-version" } });
  assert.throws(() => publishablePackages(root), /has no name or no version/);
});

test("pendingChangesets lists the changesets and refuses pre mode", (t) => {
  const root = tempDir(t);
  writeTree(root, { ".changeset/config.json": {}, ".changeset/README.md": "# Changesets\n" });
  assert.deepEqual(pendingChangesets(root), []);

  writeTree(root, { ".changeset/brave-fix.md": '---\n"@avakit/core": patch\n---\n\nFixed.\n' });
  assert.deepEqual(pendingChangesets(root), ["brave-fix.md"]);

  // `changeset pre exit` leaves pre.json behind in exit mode: a normal release.
  writeTree(root, { ".changeset/pre.json": { mode: "exit", tag: "next" } });
  assert.deepEqual(pendingChangesets(root), ["brave-fix.md"]);

  writeTree(root, { ".changeset/pre.json": { mode: "pre", tag: "next" } });
  assert.throws(() => pendingChangesets(root), /pre mode/);
});

test("the state command writes whether changesets are pending to stdout and $GITHUB_OUTPUT", (t) => {
  // Whatever this checkout holds: pending=false right after a release,
  // pending=true while changesets wait for the version PR.
  const output = join(tempDir(t), "github-output");
  writeFileSync(output, "");
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, "scripts", "release-packages.mjs"), "state"],
    { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } },
  );
  assert.equal(result.status, 0, result.stderr);
  const pending = pendingChangesets(repoRoot).length > 0;
  assert.match(result.stdout, new RegExp(`^pending=${pending}$`, "m"));
  assert.equal(readFileSync(output, "utf8"), `pending=${pending}\n`);
});

test("readTarEntry finds a file in a tarball the system tar wrote, and only that file", (t) => {
  const tgz = tarball(t, {
    "package/package.json": { name: "x", version: "1.0.0" },
    "package/dist/index.js": "export {};\n",
  });
  assert.deepEqual(JSON.parse(readTarEntry(tgz, "package/package.json").toString("utf8")), {
    name: "x",
    version: "1.0.0",
  });
  assert.equal(readTarEntry(tgz, "package/dist/index.js").toString("utf8"), "export {};\n");
  assert.equal(readTarEntry(tgz, "package/missing.json"), null);
});

test("readTarEntry reads a name longer than a tar header holds", (t) => {
  const long = `package/${"deep/".repeat(30)}file.txt`;
  const tgz = tarball(t, {
    "package/package.json": { name: "x", version: "1.0.0" },
    [long]: "far\n",
  });
  assert.equal(readTarEntry(tgz, long).toString("utf8"), "far\n");
});

test("inspectTarball gives the sums npm and sha256sum would", (t) => {
  const tgz = tarball(t, { "package/package.json": { name: "x", version: "1.0.0" } });
  const inspected = inspectTarball(tgz);
  assert.equal(inspected.sha256, createHash("sha256").update(tgz).digest("hex"));
  assert.equal(inspected.integrity, `sha512-${createHash("sha512").update(tgz).digest("base64")}`);
  assert.deepEqual(inspected.manifest, { name: "x", version: "1.0.0" });
  assert.throws(
    () => inspectTarball(tarball(t, { "package/README.md": "no manifest" })),
    /no package\/package\.json/,
  );
});

test("packedProblems names a wrong name or version and every range left for the workspace", () => {
  const pkg = { name: "@avakit/react", version: "0.2.2" };
  assert.deepEqual(
    packedProblems(
      { name: "@avakit/react", version: "0.2.2", dependencies: { "@avakit/core": "0.2.2" } },
      pkg,
    ),
    [],
  );
  const problems = packedProblems(
    {
      name: "@avakit/reakt",
      version: "0.2.3",
      dependencies: { "@avakit/core": "workspace:*" },
      peerDependencies: { react: "catalog:" },
      optionalDependencies: { a: "link:../a" },
      devDependencies: { b: "file:../b", typescript: "6.0.3" },
    },
    pkg,
  );
  assert.equal(problems.length, 6);
  assert.match(problems[0], /name is @avakit\/reakt, not @avakit\/react/);
  assert.match(problems[1], /version is 0\.2\.3, not 0\.2\.2/);
  assert.match(problems.join("\n"), /dependencies\["@avakit\/core"\] is still "workspace:\*"/);
  assert.match(problems.join("\n"), /devDependencies\["b"\] is still "file:\.\.\/b"/);
});

test("versionUrl escapes the scope the way npm does", () => {
  assert.equal(
    versionUrl("@avakit/core", "0.2.2"),
    "https://registry.npmjs.org/@avakit%2Fcore/0.2.2",
  );
  assert.equal(
    versionUrl("create-avalanche-app", "1.0.0-rc.1", "http://localhost:9/"),
    "http://localhost:9/create-avalanche-app/1.0.0-rc.1",
  );
});

test("registryStatus reads 200 and 404, retries a 5xx, and never reads an outage as unpublished", async () => {
  const url = versionUrl("@avakit/core", "0.2.2");
  const yes = fakeFetch({ [url]: [200, { name: "@avakit/core", version: "0.2.2" }] });
  assert.equal(await registryStatus("@avakit/core", "0.2.2", { fetch: yes.fetch }), "published");
  const no = fakeFetch({ [url]: [404, "version not found: 0.2.2"] });
  assert.equal(await registryStatus("@avakit/core", "0.2.2", { fetch: no.fetch }), "unpublished");

  let calls = 0;
  const flaky = async () => {
    calls++;
    return calls < 3
      ? { status: 503, json: async () => ({}) }
      : { status: 200, json: async () => ({ name: "@avakit/core", version: "0.2.2" }) };
  };
  assert.equal(
    await registryStatus("@avakit/core", "0.2.2", { fetch: flaky, retryMs: 1 }),
    "published",
  );
  assert.equal(calls, 3);

  const down = fakeFetch({ [url]: new Error("getaddrinfo ENOTFOUND") });
  await assert.rejects(
    registryStatus("@avakit/core", "0.2.2", { fetch: down.fetch, retryMs: 1 }),
    /ENOTFOUND/,
  );
  assert.equal(down.asked.length, 3);
  const forbidden = fakeFetch({ [url]: [403, {}] });
  await assert.rejects(
    registryStatus("@avakit/core", "0.2.2", { fetch: forbidden.fetch }),
    /HTTP 403/,
  );
  const other = fakeFetch({ [url]: [200, { name: "@avakit/core", version: "0.2.1" }] });
  await assert.rejects(registryStatus("@avakit/core", "0.2.2", { fetch: other.fetch }), /0\.2\.1/);
});

/** A workspace of two packages, `lib` and `app` (which needs lib), for packAll. */
function workspace(t) {
  const root = tempDir(t);
  writeTree(root, {
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "packages/lib/package.json": { name: "lib", version: "1.0.0" },
    "packages/app/package.json": {
      name: "@scope/app",
      version: "2.0.0",
      dependencies: { lib: "workspace:*" },
    },
  });
  return root;
}

/** A stand-in for `pnpm pack`: writes the tarball `manifestFor(pkg)` describes. */
function fakePack(t, manifestFor) {
  return (dir, outDir) => {
    const source = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const manifest = manifestFor(source);
    const file = join(
      outDir,
      `${source.name.replace("@", "").replace("/", "-")}-${source.version}.tgz`,
    );
    writeFileSync(file, tarball(t, { "package/package.json": manifest }));
    return file;
  };
}

test("packAll packs in dependency order and writes a manifest and sums that agree", async (t) => {
  const root = workspace(t);
  const outDir = join(tempDir(t), "release");
  const registry = fakeFetch({
    [versionUrl("lib", "1.0.0")]: [200, { name: "lib", version: "1.0.0" }],
  });
  const pack = fakePack(t, (source) => ({
    ...source,
    dependencies: source.dependencies && { lib: "1.0.0" },
  }));
  const manifest = await packAll({ root, outDir, fetch: registry.fetch, pack });

  assert.deepEqual(
    manifest.packages.map(({ name, version, file, published }) => ({
      name,
      version,
      file,
      published,
    })),
    [
      { name: "lib", version: "1.0.0", file: "lib-1.0.0.tgz", published: true },
      { name: "@scope/app", version: "2.0.0", file: "scope-app-2.0.0.tgz", published: false },
    ],
  );
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")), manifest);
  const sums = readFileSync(join(outDir, "SHA256SUMS"), "utf8");
  for (const entry of manifest.packages) {
    const bytes = readFileSync(join(outDir, entry.file));
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.ok(sums.includes(`${entry.sha256}  ${entry.file}\n`));
  }
  assert.match(
    packSummary(manifest),
    /To publish, after the npm-publish deployment is approved: @scope\/app@2\.0\.0\./,
  );
});

test("packAll fails on a packed package.json that kept a workspace range", async (t) => {
  const root = workspace(t);
  const pack = fakePack(t, (source) => source);
  await assert.rejects(
    packAll({ root, outDir: join(tempDir(t), "release"), fetch: fakeFetch({}).fetch, pack }),
    /scope-app-2\.0\.0\.tgz \(@scope\/app in packages\/app\): dependencies\["lib"\] is still "workspace:\*"/,
  );
});

test("packAll refuses a directory that already holds files", async (t) => {
  const outDir = tempDir(t);
  writeFileSync(join(outDir, "old.tgz"), "");
  await assert.rejects(
    packAll({ root: workspace(t), outDir, fetch: fakeFetch({}).fetch }),
    /is not empty/,
  );
});

// The real `pnpm pack`, on a workspace of two packages: it must write the
// version of the workspace package over `workspace:*` and `workspace:^`.
test("pnpm pack resolves workspace: ranges in what packAll publishes", {
  skip: !hasPnpm(),
}, async (t) => {
  const root = tempDir(t);
  writeTree(root, {
    "package.json": { name: "root", private: true },
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "packages/lib/package.json": { name: "lib", version: "1.4.0" },
    "packages/lib/index.js": "export const lib = 1;\n",
    "packages/app/package.json": {
      name: "@scope/app",
      version: "2.0.0",
      dependencies: { lib: "workspace:*" },
      peerDependencies: { lib: "workspace:^" },
    },
    "packages/app/index.js": "export const app = 2;\n",
  });
  const outDir = join(tempDir(t), "release");
  const manifest = await packAll({ root, outDir, fetch: fakeFetch({}).fetch });
  assert.deepEqual(
    manifest.packages.map(({ name, published }) => [name, published]),
    [
      ["lib", false],
      ["@scope/app", false],
    ],
  );
  const app = manifest.packages.find(({ name }) => name === "@scope/app");
  const packed = inspectTarball(readFileSync(join(outDir, app.file))).manifest;
  assert.deepEqual(packed.dependencies, { lib: "1.4.0" });
  assert.deepEqual(packed.peerDependencies, { lib: "^1.4.0" });
});

function hasPnpm() {
  const result = spawnSync("pnpm", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}
