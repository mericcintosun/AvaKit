/**
 * Command-line parsing for create-avalanche-app. Pure: it never reads the
 * environment, prints, or exits — it returns what was asked for, or throws a
 * `UsageError` that the caller reports.
 *
 * Strict on purpose. A typo used to be swallowed (`--tempalte nft-mint`) or
 * quietly replaced with a default (`--template nft` became `minimal`,
 * `--chain mainnet` became Fuji), so a script got a different app than it asked
 * for, and exit code 0. Anything not understood is now an error that names the
 * valid values.
 */

import { assertSafeProjectName, CHAIN_IDS, type ChainId, isChainId } from "./api.js";
import { isPackageManager, PACKAGE_MANAGERS, type PackageManager } from "./pm.js";

/** The invocation itself is wrong (bad flag or value). Reported with exit code 1. */
export class UsageError extends Error {
  override name = "UsageError";
}

export interface CliOptions {
  projectName?: string;
  template?: string;
  chain?: ChainId;
  pm?: PackageManager;
  yes: boolean;
  local: boolean;
  install: boolean;
  /** Undefined unless --telemetry / --no-telemetry was passed; both persist. */
  telemetry?: boolean;
}

export type ParsedArgs =
  | { command: "help" }
  | { command: "version" }
  | { command: "create"; options: CliOptions };

type ValueFlag = "template" | "chain" | "pm" | "wallet";

/**
 * Flags that take a value, by every spelling. A Map rather than an object, so
 * that a project called `constructor` or `toString` is looked up as a name.
 */
const VALUE_FLAGS = new Map<string, ValueFlag>([
  ["--template", "template"],
  ["-t", "template"],
  ["--chain", "chain"],
  ["-c", "chain"],
  ["--pm", "pm"],
  // `--wallet` was removed: every scaffold now ships all three wallets (burner,
  // injected, web3auth), so the flag chose nothing. It is still accepted, with
  // its value, so an old invocation keeps working instead of failing as unknown.
  ["--wallet", "wallet"],
  ["-w", "wallet"],
]);

/** Flags that take no value, and what each one sets. */
const SWITCHES = new Map<string, Partial<CliOptions>>([
  ["--yes", { yes: true }],
  ["-y", { yes: true }],
  ["--local", { local: true }],
  ["--no-install", { install: false }],
  ["--no-telemetry", { telemetry: false }],
  ["--telemetry", { telemetry: true }],
]);

function list(values: readonly string[]): string {
  return values.join(", ");
}

/**
 * @param args The arguments after the node binary and the script path.
 * @param templateIds The templates that exist, to check `--template` against.
 */
export function parseArgs(args: readonly string[], templateIds: readonly string[]): ParsedArgs {
  // Asking for help or the version always works, even next to a mistyped flag.
  if (args.includes("--help") || args.includes("-h")) return { command: "help" };
  if (args.includes("--version") || args.includes("-v")) return { command: "version" };

  const valid: Record<Exclude<ValueFlag, "wallet">, readonly string[]> = {
    template: templateIds,
    chain: CHAIN_IDS,
    pm: PACKAGE_MANAGERS,
  };
  const opts: CliOptions = { yes: false, local: false, install: true };
  const values: { template?: string; chain?: string; pm?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    // `npm create avalanche-app name -- --yes` strips the separator itself; some
    // launchers pass it through. Either way the flags after it are still ours.
    if (arg === "--") continue;

    // `--flag=value` is the same as `--flag value`.
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);

    const valueFlag = VALUE_FLAGS.get(flag);
    if (valueFlag) {
      // The next argument is the value, unless it is itself a flag.
      const following = args[i + 1];
      const value =
        inline ?? (following !== undefined && !following.startsWith("-") ? following : undefined);
      if (inline === undefined && value !== undefined) i++;
      if (valueFlag === "wallet") continue;
      if (value === undefined) {
        throw new UsageError(`Option ${flag} needs a value: ${list(valid[valueFlag])}.`);
      }
      values[valueFlag] = value;
      continue;
    }

    const toggled = SWITCHES.get(flag);
    if (toggled) {
      if (inline !== undefined) throw new UsageError(`Option ${flag} does not take a value.`);
      Object.assign(opts, toggled);
      continue;
    }

    if (arg.startsWith("-")) throw new UsageError(`Unknown option "${arg}".`);

    if (opts.projectName !== undefined) {
      throw new UsageError(
        `Unexpected argument "${arg}": the project name is already "${opts.projectName}".`,
      );
    }
    opts.projectName = arg;
  }

  if (opts.projectName !== undefined) {
    try {
      assertSafeProjectName(opts.projectName);
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
  }
  if (values.template !== undefined) {
    if (!templateIds.includes(values.template)) {
      throw new UsageError(
        `Unknown template "${values.template}". Valid templates: ${list(templateIds)}.`,
      );
    }
    opts.template = values.template;
  }
  if (values.chain !== undefined) {
    if (!isChainId(values.chain)) {
      throw new UsageError(`Unknown chain "${values.chain}". Valid chains: ${list(CHAIN_IDS)}.`);
    }
    opts.chain = values.chain;
  }
  if (values.pm !== undefined) {
    // The name becomes the command we spawn (through a shell on Windows) and a
    // telemetry field, so nothing but the four known managers gets past here.
    if (!isPackageManager(values.pm)) {
      throw new UsageError(
        `Unknown package manager "${values.pm}". Valid package managers: ${list(PACKAGE_MANAGERS)}.`,
      );
    }
    opts.pm = values.pm;
  }

  return { command: "create", options: opts };
}
