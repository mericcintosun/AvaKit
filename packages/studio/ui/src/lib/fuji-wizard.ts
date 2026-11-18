/**
 * The "Launch on Fuji" wizard's state, as a pure reducer. It lives above the
 * view switch (so leaving the view does not reset it) and it follows the
 * server's Fuji runs (so a reload in the middle of a transfer or a deploy lands
 * back on the right step with the right L1).
 */

import type { RunInfo } from "./run-store";

export type FujiStep = "fund" | "transfer" | "deploy" | "live";
export const FUJI_STEPS: FujiStep[] = ["fund", "transfer", "deploy", "live"];

export interface FujiForm {
  name: string;
  chainId: string;
  token: string;
  amount: string;
}

export interface FujiBalance {
  address: string | null;
  cBalance: string;
  /** Why the balance could not be read, or null when it was. */
  error?: string | null;
}

export interface FujiL1 {
  deployed: boolean;
  rpcUrl: string | null;
  blockchainId: string | null;
  evmChainId: number | null;
  running: boolean;
}

export interface FujiWizardState {
  form: FujiForm;
  step: FujiStep;
  /**
   * The C-Chain address of the key named `form.name` — null until that key has
   * been created or looked up. It always belongs to the CURRENT name: every
   * action (balance, transfer, deploy) uses the key called `form.name`, so an
   * address left over from another name would be a lie.
   */
  address: string | null;
  cBalance: string;
  /** Why the balance could not be read, if the last attempt failed. */
  balanceError: string | null;
  /** The deployed L1, once avalanche-cli has recorded it. */
  l1: FujiL1 | null;
}

export const initialFujiWizard: FujiWizardState = {
  form: { name: "myfujil1", chainId: "77777", token: "FUJ", amount: "0.3" },
  step: "fund",
  address: null,
  cBalance: "0",
  balanceError: null,
  l1: null,
};

export type FujiWizardAction =
  | { type: "edit"; field: keyof FujiForm; value: string }
  /** The key named `name` was created or found (or could not be). */
  | { type: "key"; name: string; address: string | null }
  /** A balance reading for the key named `name`. */
  | { type: "balance"; name: string; balance: FujiBalance }
  /** The key is funded: move on to the C→P transfer. */
  | { type: "funded" }
  /** A Fuji run was started, is running, or has ended (here or in another tab). */
  | { type: "run"; run: RunInfo }
  /** What avalanche-cli knows about the deployed L1 called `name`. */
  | { type: "l1"; name: string; l1: FujiL1 }
  | { type: "reset" };

/** The wizard step a Fuji run puts the wizard on. */
export function stepForRun(run: RunInfo): FujiStep {
  const own: FujiStep = run.action === "transfer" ? "transfer" : "deploy";
  const succeeded = run.status === "done" && run.exitCode === 0 && !run.cancelled;
  if (!succeeded) return own; // still running, or failed: this is the step to (re)try
  return own === "transfer" ? "deploy" : "live";
}

export function fujiWizardReducer(
  state: FujiWizardState,
  action: FujiWizardAction,
): FujiWizardState {
  switch (action.type) {
    case "edit": {
      // The configuration is fixed once the wizard has moved past funding.
      if (state.step !== "fund" || state.form[action.field] === action.value) return state;
      const form = { ...state.form, [action.field]: action.value };
      if (action.field !== "name") return { ...state, form };
      // A different name is a different key: forget the old key's address and balance.
      return { ...state, form, address: null, cBalance: "0", balanceError: null };
    }

    case "key":
      // The answer to a request made for another name (the user typed on) is stale.
      if (action.name !== state.form.name) return state;
      return { ...state, address: action.address, cBalance: "0", balanceError: null };

    case "balance": {
      if (action.name !== state.form.name) return state;
      if (action.balance.address !== state.address) return state;
      if (action.balance.error) return { ...state, balanceError: action.balance.error };
      return { ...state, cBalance: action.balance.cBalance, balanceError: null };
    }

    case "funded":
      return state.step === "fund" && state.address ? { ...state, step: "transfer" } : state;

    case "run": {
      const { run } = action;
      if (run.kind !== "fuji") return state;
      const form: FujiForm = {
        name: run.params.name ?? state.form.name,
        chainId: run.params.chainId ?? state.form.chainId,
        token: run.params.symbol ?? state.form.token,
        amount: run.params.amount ?? state.form.amount,
      };
      const step = stepForRun(run);
      if (form.name !== state.form.name) {
        // Another L1 than the one on screen (started in another tab, or before a reload).
        return { ...initialFujiWizard, form, step };
      }
      return { ...state, form, step, l1: step === "live" ? state.l1 : null };
    }

    case "l1":
      return action.name === state.form.name ? { ...state, l1: action.l1 } : state;

    case "reset":
      return { ...initialFujiWizard, form: state.form };
  }
}
