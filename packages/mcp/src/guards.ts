import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { type AvaChain, isMainnet } from "@avakit/core";
import { assertSafeProjectName } from "create-avalanche-app/api";

/**
 * Upper bounds for MCP tool inputs. The schemas used to accept `z.array(z.any())`
 * and an unconstrained bytecode string, so a confused or malicious caller could
 * hand over a huge or malformed payload. Generous, but no longer unbounded, and
 * bytecode must actually be hex. (security audit A16)
 */
export const MAX_ABI_ITEMS = 5000;
export const MAX_ARGS = 100;
/** ~1 MB of hex — comfortably above any real EVM creation bytecode. */
export const MAX_BYTECODE_LEN = 2_000_000;
/** Creation bytecode: an optional `0x` prefix followed by hex digits. */
export const BYTECODE_RE = /^(0x)?[0-9a-fA-F]+$/;
/** A 20-byte address as hex. Whether its capitalisation is a valid checksum is checked separately. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Mainnet transactions require TWO independent approvals: the tool caller's
 * `confirm: true` AND an out-of-band `AVAKIT_ALLOW_MAINNET=1` server env var.
 *
 * An AI agent can be talked into setting `confirm` by a prompt-injected
 * instruction, but it cannot set an environment variable on the machine
 * running the MCP server — so a malicious prompt alone can never spend real
 * funds. Testnet chains are unaffected. (security audit A2)
 *
 * @param action What is being refused, for the message: a deploy by default,
 *   "send" for a contract call. The two gates are the same for both.
 */
export function assertMainnetAllowed(
  chain: AvaChain,
  confirm: boolean | undefined,
  action: "deploy" | "send" = "deploy",
): void {
  if (!isMainnet(chain)) return;
  const refusing =
    action === "deploy"
      ? `Refusing to deploy to ${chain.name} (mainnet)`
      : `Refusing to send a transaction on ${chain.name} (mainnet)`;
  if (!confirm) {
    throw new Error(`${refusing} without confirm:true.`);
  }
  if (!mainnetOpenedByOperator()) {
    throw new Error(
      `${refusing}: set AVAKIT_ALLOW_MAINNET=1 in the ` +
        `server environment to allow mainnet ${action === "deploy" ? "deploys" : "transactions"}. ` +
        "This out-of-band gate cannot be set by a tool caller.",
    );
  }
}

/** Set to 1 in the server's environment to allow mainnet transactions at all. */
export const ALLOW_MAINNET_ENV = "AVAKIT_ALLOW_MAINNET";

/** The half of the mainnet gate that lives in the server's environment. */
export function mainnetOpenedByOperator(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_MAINNET_ENV] === "1";
}

/** Names the directory this server works in, instead of the server's cwd. */
export const SCAFFOLD_ROOT_ENV = "AVAKIT_MCP_ROOT";

/**
 * `target` with the symlinks in its existing part resolved. The rest is kept as
 * written: a project that is about to be created does not exist yet, and
 * neither may some of the directories above it.
 */
function realPath(target: string): string {
  const missing: string[] = [];
  let existing = path.resolve(target);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missing);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/**
 * The one directory this server touches files in: it creates projects there
 * and reads contract artifacts from there, and nowhere else.
 */
export interface Workspace {
  /** The server's working directory, or `AVAKIT_MCP_ROOT` resolved against it. */
  root: string;
  /** `root` with its symlinks resolved, which is what containment is checked on. */
  realRoot: string;
  /**
   * True when `root` is the filesystem root and the server environment did not
   * name it. Every path on the disk is inside that, so it constrains nothing.
   */
  unconstrained: boolean;
}

export function resolveWorkspace(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Workspace {
  const configured = env[SCAFFOLD_ROOT_ENV]?.trim();
  const root = configured ? path.resolve(cwd, configured) : cwd;
  const realRoot = realPath(root);
  return { root, realRoot, unconstrained: !configured && path.parse(realRoot).root === realRoot };
}

/**
 * `target` resolved to a real path when it lies inside the workspace, or
 * undefined when it does not. Containment is checked on real paths, so a symlink
 * inside the root that points outside it is not a way out.
 */
export function insideWorkspace(workspace: Workspace, target: string): string | undefined {
  const real = realPath(target);
  return isInside(workspace.realRoot, real) ? real : undefined;
}

/**
 * Where `scaffold_app` will create a project, or an error if that is somewhere
 * it may not write.
 *
 * `name` was already limited to one safe path segment, but `directory` took any
 * path — `"/Users/me/.config"`, `"../../.."` — so an agent following a
 * prompt-injected instruction could plant a project tree anywhere the user can
 * write. Projects now go under one root: the server's working directory, or the
 * directory named by `AVAKIT_MCP_ROOT`. Like the mainnet gate, that variable is
 * set by whoever runs the server; a tool caller cannot change it.
 *
 * Containment is checked on real paths, so a symlink inside the root that
 * points outside it is not a way out.
 *
 * A working directory that is the filesystem root constrains nothing: every path
 * on the disk is inside it. Some clients start servers there (Claude Desktop on
 * macOS, in `/`), so in that case there is no root until the server names one.
 */
export function resolveScaffoldTarget(
  name: string,
  directory: string | undefined,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertSafeProjectName(name);
  const workspace = resolveWorkspace(cwd, env);
  const { root } = workspace;
  if (workspace.unconstrained) {
    throw new Error(
      `Refusing to scaffold: this server was started in "${root}", which is not a project folder, ` +
        `so it has no directory to create projects in. Set ${SCAFFOLD_ROOT_ENV} in the server ` +
        `environment to the directory new projects should go in — a tool caller cannot set it.`,
    );
  }
  // Relative to the root, so with AVAKIT_MCP_ROOT set a bare name lands in it.
  const parent = directory ? path.resolve(root, directory) : root;
  const target = path.resolve(parent, name);
  if (!insideWorkspace(workspace, target)) {
    throw new Error(
      `Refusing to scaffold into "${parent}": it is outside "${root}", the only directory this ` +
        `server creates projects in. Pass a directory inside it, or set ${SCAFFOLD_ROOT_ENV} in the ` +
        `server environment to use another root — a tool caller cannot set it.`,
    );
  }
  return target;
}
