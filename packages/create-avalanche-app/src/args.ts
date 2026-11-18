/**
 * Command-line parsing for create-avalanche-app. Pure: it never reads the
 * environment, prints, or exits — it returns what was asked for, or throws a
 * `UsageError` that the caller reports.
 */

import type { ChainId } from "./api.js";
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

/** @param args The arguments after the node binary and the script path. */
export function parseArgs(args: readonly string[]): ParsedArgs {
  const opts: CliOptions = { yes: false, local: false, install: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    switch (arg) {
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--local":
        opts.local = true;
        break;
      case "--no-install":
        opts.install = false;
        break;
      case "--no-telemetry":
        opts.telemetry = false;
        break;
      case "--telemetry":
        opts.telemetry = true;
        break;
      case "--template":
      case "-t":
        opts.template = next();
        break;
      // `--wallet` was removed: every scaffold now ships all three wallets
      // (burner, injected, web3auth), so the flag chose nothing. Still consume
      // its argument if an old invocation passes it, so `-w injected` can't be
      // mistaken for the project name.
      case "--wallet":
      case "-w":
        next();
        break;
      case "--chain":
      case "-c":
        opts.chain = next() as ChainId;
        break;
      case "--pm": {
        // Validated here, before anything can run it: the name becomes the
        // command we spawn (through a shell on Windows) and a telemetry field.
        const value = next();
        if (!isPackageManager(value)) {
          throw new UsageError(
            `Unknown package manager "${value ?? ""}". Valid package managers: ${PACKAGE_MANAGERS.join(", ")}.`,
          );
        }
        opts.pm = value;
        break;
      }
      case "--version":
      case "-v":
        return { command: "version" };
      case "--help":
      case "-h":
        return { command: "help" };
      default:
        if (arg && !arg.startsWith("-") && !opts.projectName) {
          opts.projectName = arg;
        }
    }
  }
  return { command: "create", options: opts };
}
