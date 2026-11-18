/**
 * Contract artifacts by reference.
 *
 * The nft-mint template's creation bytecode is about fifteen thousand hex characters and its
 * ABI is 360 lines of JSON. An agent asked to copy that into a tool argument
 * will spend minutes generating it and can corrupt it on the way, so
 * `deploy_contract` and `write_contract` take a path to the file instead, and
 * `scaffold_app` returns the paths it created.
 *
 * Two rules keep "read a file an agent names" from becoming "read any file":
 * the path must lie inside the server's workspace (the same root `scaffold_app`
 * writes in, see guards.ts), and a file that is not an artifact is refused with
 * a fixed message — its contents are never quoted back, whatever they are.
 */

import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import type { Abi, Hex } from "viem";
import { describeFunction, normalizeAbi, writeFunctions } from "./abi.js";
import { ToolError } from "./errors.js";
import {
  BYTECODE_RE,
  insideWorkspace,
  MAX_BYTECODE_LEN,
  resolveWorkspace,
  SCAFFOLD_ROOT_ENV,
} from "./guards.js";

/** Largest artifact file read. Foundry's biggest outputs are a few hundred KB. */
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const ACCEPTED_SHAPES =
  'Two shapes are accepted: (1) a JSON file with "abi" and "bytecode", where bytecode is a 0x hex ' +
  'string or Foundry\'s { "object": "0x…" } — for example contracts/out/Counter.sol/Counter.json ' +
  "after `forge build`; (2) an AvaKit template artifact module such as lib/nft-artifact.ts, with " +
  '`export const abi = [ … ]` in the compiler\'s JSON form and `export const bytecode = "0x…"`.';

export interface ContractArtifact {
  abi: Abi;
  /** Creation bytecode, or null when the artifact has none (an interface, an ABI-only file). */
  bytecode: Hex | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Thrown by the parsers below; `readArtifact` adds which file it was. */
class ShapeError extends Error {}

function checkedBytecode(raw: string): Hex | null {
  if (raw === "0x" || raw === "") return null;
  if (raw.length > MAX_BYTECODE_LEN) {
    throw new ShapeError(`its bytecode is longer than ${MAX_BYTECODE_LEN} characters`);
  }
  if (!BYTECODE_RE.test(raw)) {
    throw new ShapeError(
      "its bytecode is not plain hex (a Foundry artifact with unlinked libraries has placeholders in it)",
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function checkedAbi(raw: unknown): Abi {
  if (!Array.isArray(raw)) throw new ShapeError('it has no "abi" array');
  try {
    return normalizeAbi(raw);
  } catch {
    // normalizeAbi explains what is wrong by quoting the entry. That is right
    // for an ABI a caller typed, and not for text that came out of a file.
    throw new ShapeError('its "abi" is not a valid ABI');
  }
}

/** Shape 1: `{ "abi": [...], "bytecode": "0x…" | { "object": "0x…" } }`. */
function fromJson(source: string): ContractArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    // The parser's own message quotes the text it choked on. Not passed on.
    throw new ShapeError("it is not valid JSON");
  }
  if (!isRecord(parsed)) throw new ShapeError("it is not a JSON object");
  const abi = checkedAbi(parsed.abi);
  const { bytecode } = parsed;
  if (bytecode === undefined || bytecode === null) return { abi, bytecode: null };
  const object = isRecord(bytecode) ? bytecode.object : bytecode;
  if (typeof object !== "string") throw new ShapeError('its "bytecode" is not a hex string');
  return { abi, bytecode: checkedBytecode(object) };
}

/**
 * The array literal assigned by `export const <name> = [ … ]`, as text.
 *
 * Found by walking the brackets, not by running anything: the file is source
 * code from a project directory and is never evaluated. Strings are skipped so
 * that a bracket inside one does not count.
 */
function exportedArray(source: string, name: string): string | undefined {
  // A type annotation (`: Abi`) is one line of at most 200 characters. Unbounded, as
  // `[^=]*`, it made a file of many `export const abi:` without an `=` cost quadratic
  // time, and the parse is synchronous, so such a file could stall every tool.
  const declaration = new RegExp(
    `(?:^|[\\s;])export\\s+const\\s+${name}\\s*(?::[^=\\n]{0,200})?=\\s*\\[`,
  );
  const match = declaration.exec(source);
  if (!match) return undefined;
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return source.slice(start, i + 1);
  }
  return undefined;
}

/** Shape 2: an AvaKit template artifact module (`lib/*-artifact.ts`). */
function fromModule(source: string): ContractArtifact {
  const literal = exportedArray(source, "abi");
  if (literal === undefined) throw new ShapeError("it has no `export const abi = [ … ]`");
  let abi: unknown;
  try {
    abi = JSON.parse(literal);
  } catch {
    throw new ShapeError(
      "its `abi` array is not in the compiler's JSON form (a formatter may have rewritten it " +
        "with unquoted keys or trailing commas)",
    );
  }
  const declared = /(?:^|[\s;])export\s+const\s+bytecode\b/.test(source);
  // One quoted string and then the end of the statement (or `as Hex`): a value
  // built up with `+` is not something to guess the rest of.
  // The type annotation is bounded for the same reason as in exportedArray().
  const bytecode =
    /(?:^|[\s;])export\s+const\s+bytecode\s*(?::[^=\n]{0,200})?=\s*(["'`])([^"'`\s]*)\1(?=\s*(?:;|$|as\b|satisfies\b))/m.exec(
      source,
    )?.[2];
  if (declared && bytecode === undefined) {
    throw new ShapeError("its `bytecode` export is not a single hex string");
  }
  return {
    abi: checkedAbi(abi),
    bytecode: bytecode === undefined ? null : checkedBytecode(bytecode),
  };
}

/**
 * Read an artifact out of a file's text, without evaluating any of it.
 *
 * @param label How to name the file in an error; the text itself is never quoted.
 */
export function parseArtifact(source: string, label: string): ContractArtifact {
  // A byte-order mark is not part of either shape.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  try {
    return text.trimStart().startsWith("{") ? fromJson(text) : fromModule(text);
  } catch (error) {
    if (!(error instanceof ShapeError)) throw error;
    throw new ToolError(
      `"${label}" is not a contract artifact this server can read: ${error.message}. ${ACCEPTED_SHAPES}`,
    );
  }
}

/**
 * The file an `artifactPath` names, as a real path inside the workspace.
 *
 * The containment rule is the one `scaffold_app` applies to its `directory`:
 * relative paths are resolved against the server's working directory (or
 * `AVAKIT_MCP_ROOT`), anything that ends up outside it is refused — through
 * `..`, an absolute path, or a symlink — and a server started in the filesystem
 * root has no workspace until its environment names one.
 */
export function resolveArtifactPath(
  artifactPath: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspace = resolveWorkspace(cwd, env);
  if (workspace.unconstrained) {
    throw new ToolError(
      `Refusing to read "${artifactPath}": this server was started in "${workspace.root}", which is ` +
        `not a project folder, so it has no directory to read contract artifacts from. Set ` +
        `${SCAFFOLD_ROOT_ENV} in the server environment to your projects directory — a tool caller ` +
        "cannot set it — or pass abi and bytecode instead.",
    );
  }
  const real = artifactPath.includes("\0")
    ? undefined
    : insideWorkspace(workspace, path.resolve(workspace.root, artifactPath));
  if (!real) {
    throw new ToolError(
      `Refusing to read "${artifactPath}": it is outside "${workspace.root}", the only directory this ` +
        `server reads contract artifacts from. Pass a path inside it, or set ${SCAFFOLD_ROOT_ENV} in ` +
        "the server environment to use another root — a tool caller cannot set it.",
    );
  }
  return real;
}

/** The text of a regular file of at most MAX_ARTIFACT_BYTES, or an error that says why not. */
function readBounded(file: string, label: string): string {
  let descriptor: number;
  try {
    // Non-blocking, so that a named pipe is refused below instead of being
    // waited on for a writer that never comes.
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ToolError(
      code === "ENOENT" || code === "ENOTDIR"
        ? `No file at "${label}". Paths are relative to the server's working directory; scaffold_app ` +
            "returns the artifact paths of a new project as `artifacts`."
        : code === "EISDIR"
          ? `"${label}" is a directory; artifactPath must name a file.`
          : `Could not open "${label}" (${code ?? "unknown error"}).`,
    );
  }
  try {
    // On the open file, so what is checked is what is read.
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new ToolError(
        `"${label}" is ${stats.isDirectory() ? "a directory" : "not a regular file"}; artifactPath must name a file.`,
      );
    }
    if (stats.size > MAX_ARTIFACT_BYTES) {
      throw new ToolError(
        `"${label}" is ${(stats.size / (1024 * 1024)).toFixed(1)} MB; artifact files over 2 MB are refused.`,
      );
    }
    const buffer = Buffer.alloc(stats.size);
    let read = 0;
    while (read < buffer.length) {
      const chunk = readSync(descriptor, buffer, read, buffer.length - read, read);
      if (chunk === 0) break;
      read += chunk;
    }
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(descriptor);
  }
}

/** Read the artifact a tool argument points at. Throws a `ToolError` that says what to do. */
export function readArtifact(
  artifactPath: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ContractArtifact {
  const file = resolveArtifactPath(artifactPath, cwd, env);
  return parseArtifact(readBounded(file, artifactPath), artifactPath);
}

/** The creation bytecode of an artifact, or an error when it has none to deploy. */
export function deployableBytecode(artifact: ContractArtifact, label: string): Hex {
  if (artifact.bytecode === null) {
    throw new ToolError(
      `"${label}" has an ABI but no creation bytecode, so there is nothing to deploy ` +
        "(it describes an interface, an abstract contract, or an already deployed one).",
    );
  }
  return artifact.bytecode;
}

export interface FoundArtifact {
  /** Path relative to the workspace root, with forward slashes: ready to pass as `artifactPath`. */
  path: string;
  artifact: ContractArtifact;
}

/**
 * The deployable artifacts among a new project's files.
 *
 * Only files that really load are listed: a name that contains "artifact" is a
 * hint, reading the file is the test. So a path returned here is one
 * `deploy_contract` will accept.
 *
 * @param projectDir The project's directory (absolute).
 * @param files The project's files, relative to `projectDir`.
 * @param root The workspace root the returned paths are relative to.
 */
export function findArtifacts(
  projectDir: string,
  files: readonly string[],
  root: string,
): FoundArtifact[] {
  const found: FoundArtifact[] = [];
  for (const file of files) {
    if (!/artifact[^/\\]*\.(ts|js|mjs|json)$/i.test(file)) continue;
    const absolute = path.join(projectDir, file);
    try {
      const artifact = parseArtifact(readBounded(absolute, file), file);
      if (artifact.bytecode === null) continue;
      found.push({ path: path.relative(root, absolute).split(path.sep).join("/"), artifact });
    } catch {
      // Not an artifact after all (the bridge template's multi-contract JSON, say).
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The `nextSteps` line that tells an agent how to deploy and call what was just
 * scaffolded, without opening a file: the exact arguments, and the functions
 * there are to call.
 */
export function deployHint({ path: artifactPath, artifact }: FoundArtifact): string {
  const constructorInputs = artifact.abi.find((item) => item.type === "constructor")?.inputs ?? [];
  const deployArgs =
    constructorInputs.length > 0
      ? `, args: [${constructorInputs.map((input, i) => input.name || `arg${i}`).join(", ")}]`
      : "";
  const functions = writeFunctions(artifact.abi);
  const example = functions.find((item) => item.name === "mint") ?? functions[0];
  const call = example
    ? `, then call it with write_contract({ address, artifactPath: "${artifactPath}", functionName: "${example.name}"` +
      `${example.inputs.length > 0 ? `, args: [${example.inputs.map((input, i) => input.name || `arg${i}`).join(", ")}]` : ""} })`
    : "";
  const list =
    functions.length > 0
      ? ` State-changing functions: ${functions.slice(0, 12).map(describeFunction).join(", ")}${functions.length > 12 ? ", …" : ""}.`
      : "";
  return (
    "From this MCP server, with no key to set up on the Fuji testnet: " +
    `deploy_contract({ artifactPath: "${artifactPath}"${deployArgs} })${call}.${list}`
  );
}
