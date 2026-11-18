/**
 * Where avalanche-cli and Studio keep their files. Resolved on every call, not
 * captured at import, so the paths always follow the current home directory.
 */

import { homedir } from "node:os";
import path from "node:path";

/** avalanche-cli's per-L1 configs: ~/.avalanche-cli/subnets/<name>/{sidecar,genesis}.json */
export function subnetsDir(): string {
  return path.join(homedir(), ".avalanche-cli", "subnets");
}

/** avalanche-cli's stored keys: ~/.avalanche-cli/key/<name>.pk */
export function keyDir(): string {
  return path.join(homedir(), ".avalanche-cli", "key");
}

/** Studio's own state: ~/.avakit-studio */
export function studioStateDir(): string {
  return path.join(homedir(), ".avakit-studio");
}
