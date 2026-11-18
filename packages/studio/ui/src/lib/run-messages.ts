/** What the dashboard says about a run: its name, and the notice when it ends. */

import { RunBusyError, type RunInfo } from "./run-store";

export interface Notice {
  title: string;
  description: string;
  variant: "success" | "error" | "info";
}

const LABELS: Record<string, string> = {
  "devnet:create-icm": "Spin up ICM devnet",
  "devnet:create-l1": "Launch L1",
  "devnet:start": "Start network",
  "devnet:stop": "Stop network",
  "fuji:transfer": "C→P transfer",
  "fuji:deploy": "Deploy to Fuji",
};

/** A short name for a run: "Spin up ICM devnet", "Deploy to Fuji". */
export function runLabel(run: Pick<RunInfo, "kind" | "action">): string {
  return LABELS[`${run.kind}:${run.action}`] ?? `${run.kind} ${run.action}`;
}

/** The view whose console shows a run's output. */
export function runHome(run: Pick<RunInfo, "kind">): "devnet" | "fuji" {
  return run.kind === "fuji" ? "fuji" : "devnet";
}

/**
 * What a run's console shows: which action it is, the server's log, and a
 * closing line once it has succeeded (a failure or a cancel already ends with
 * the runner's own "✖ exited with code …" / "■ cancelled" line).
 */
export function consoleLines(run: RunInfo, log: string[]): string[] {
  const succeeded = run.status === "done" && run.exitCode === 0 && !run.cancelled;
  return [`▸ ${run.action}`, ...log, ...(succeeded ? ["✔ done"] : [])];
}

const SUCCESS: Record<string, { title: string; description: string }> = {
  "devnet:create-icm": {
    title: "Devnet is ready",
    description:
      "Two L1s are running with ICM and a relayer. Head to Interchain to deploy the messengers and send a message.",
  },
  "devnet:create-l1": {
    title: "Your L1 is live",
    description: "It's deployed locally. Its RPC is on its card in Devnet — point a dapp at it.",
  },
  "devnet:start": { title: "Network started", description: "Your local L1s are back up." },
  "devnet:stop": {
    title: "Network stopped",
    description: "State is preserved — start it again anytime.",
  },
  "fuji:transfer": {
    title: "Funds on the P-Chain",
    description: "Now deploy your L1 to Fuji.",
  },
  "fuji:deploy": { title: "L1 deployed to Fuji", description: "Verifying it's live…" },
};

/** Shown under a console whose live connection dropped while the action was going. */
export const LOST_NOTE =
  "Lost the live connection to this action — it may still be running. Studio picks it up again as soon as it can.";

/** What to tell the user when an action could not be started. */
export function startFailureNotice(error: unknown): Notice {
  if (error instanceof RunBusyError) {
    return {
      title: "Another action is running",
      description: error.run
        ? `“${runLabel(error.run)}” has not finished yet — its output is shown in ${
            error.run.kind === "fuji" ? "Launch on Fuji" : "Devnet"
          }.`
        : // It belongs to another Studio process; the server's words name it.
          error.message,
      variant: "info",
    };
  }
  return {
    title: "Could not start",
    description: error instanceof Error ? error.message : String(error),
    variant: "error",
  };
}

/** Asked before stopping an action: what interrupting it can leave behind. */
export function cancelWarning(run: Pick<RunInfo, "kind" | "action">): string {
  const consequence =
    run.kind === "fuji"
      ? "Interrupting it between its P-Chain transactions can leave the L1 half-created, and testnet AVAX already spent on fees is not refunded."
      : "The devnet may be left half set up.";
  return `Stop “${runLabel(run)}”? ${consequence}`;
}

/** What to tell the user when a run this tab was following comes to an end. */
export function finishNotice(run: RunInfo): Notice {
  const where = run.kind === "fuji" ? "Launch on Fuji" : "Devnet";
  if (run.cancelled) {
    return {
      title: "Action cancelled",
      description: `“${runLabel(run)}” was stopped before it finished.`,
      variant: "info",
    };
  }
  if (run.exitCode !== 0) {
    return {
      title: run.kind === "fuji" ? "Step failed" : "Something went wrong",
      description: `“${runLabel(run)}” did not finish. See the console in ${where} for the full output.`,
      variant: "error",
    };
  }
  const success = SUCCESS[`${run.kind}:${run.action}`] ?? {
    title: "Done",
    description: `“${runLabel(run)}” finished.`,
  };
  return { ...success, variant: "success" };
}
