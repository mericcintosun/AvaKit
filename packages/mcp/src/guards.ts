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

/**
 * Mainnet deploys require TWO independent approvals: the tool caller's
 * `confirm: true` AND an out-of-band `AVAKIT_ALLOW_MAINNET=1` server env var.
 *
 * An AI agent can be talked into setting `confirm` by a prompt-injected
 * instruction, but it cannot set an environment variable on the machine
 * running the MCP server — so a malicious prompt alone can never spend real
 * funds. Testnet chains are unaffected. (security audit A2)
 */
export function assertMainnetAllowed(chain: AvaChain, confirm: boolean | undefined): void {
  if (!isMainnet(chain)) return;
  if (!confirm) {
    throw new Error(`Refusing to deploy to ${chain.name} (mainnet) without confirm:true.`);
  }
  if (process.env.AVAKIT_ALLOW_MAINNET !== "1") {
    throw new Error(
      `Refusing to deploy to ${chain.name} (mainnet): set AVAKIT_ALLOW_MAINNET=1 in the ` +
        `server environment to allow mainnet deploys. This out-of-band gate cannot be set by a tool caller.`,
    );
  }
}

/** Names the directory `scaffold_app` may create projects in, instead of the server's cwd. */
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
  const configured = env[SCAFFOLD_ROOT_ENV]?.trim();
  const root = configured ? path.resolve(cwd, configured) : cwd;
  const realRoot = realPath(root);
  if (!configured && path.parse(realRoot).root === realRoot) {
    throw new Error(
      `Refusing to scaffold: this server was started in "${root}", which is not a project folder, ` +
        `so it has no directory to create projects in. Set ${SCAFFOLD_ROOT_ENV} in the server ` +
        `environment to the directory new projects should go in — a tool caller cannot set it.`,
    );
  }
  // Relative to the root, so with AVAKIT_MCP_ROOT set a bare name lands in it.
  const parent = directory ? path.resolve(root, directory) : root;
  const target = path.resolve(parent, name);
  if (!isInside(realRoot, realPath(target))) {
    throw new Error(
      `Refusing to scaffold into "${parent}": it is outside "${root}", the only directory this ` +
        `server creates projects in. Pass a directory inside it, or set ${SCAFFOLD_ROOT_ENV} in the ` +
        `server environment to use another root — a tool caller cannot set it.`,
    );
  }
  return target;
}
