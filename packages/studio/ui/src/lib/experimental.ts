/**
 * What the dashboard says about the views that drive Avalanche CLI. They are
 * experimental: Ava Labs keeps the CLI in maintenance mode, and these views
 * were last proven end to end against a live network in July 2026 (see
 * "Experimental: the Avalanche CLI views" in the package README).
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

/** The note at the top of each of them. */
export const EXPERIMENTAL_NOTE =
  "This view drives Avalanche CLI, which Ava Labs has kept in maintenance mode since December 2025. " +
  "It was last proven end to end against a live network in July 2026, so another CLI version may behave differently.";

export function isExperimental(view: View): boolean {
  return EXPERIMENTAL_VIEWS.has(view);
}
