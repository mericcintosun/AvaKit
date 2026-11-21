/**
 * What the dashboard says about the views that depend on Avalanche CLI. They
 * are experimental: Ava Labs keeps the CLI in maintenance mode, and these views
 * were last proven end to end against a live network in July 2026, before
 * Studio changed (see "Experimental: the Avalanche CLI views" in the package
 * README).
 */

import type { View } from "../components/Sidebar";

/** The views that run Avalanche CLI, or read and change what it set up. */
export const EXPERIMENTAL_VIEWS: ReadonlySet<View> = new Set<View>([
  "devnet",
  "fuji",
  "interchain",
]);

/** The sidebar section that holds them. */
export const EXPERIMENTAL_SECTION = "Avalanche CLI · experimental";

/**
 * The note at the top of each of them. It holds for all three: Devnet and
 * Launch on Fuji run the CLI, and Interchain works on the local L1s the CLI
 * set up (it reads what the CLI recorded, and signs its transactions itself).
 */
export const EXPERIMENTAL_NOTE =
  "This view depends on Avalanche CLI: it runs the CLI, or works on what the CLI set up. Ava Labs has kept the CLI in maintenance mode since December 2025. " +
  "The view was last proven end to end against a live network in July 2026, and Studio has changed since, so a run may behave differently, especially with another CLI version.";

export function isExperimental(view: View): boolean {
  return EXPERIMENTAL_VIEWS.has(view);
}
