/**
 * The "Launch on Fuji" wizard's state, as a pure reducer. It lives above the
 * view switch (so leaving the view does not reset it) and it follows the
 * server's Fuji runs (so a reload in the middle of a transfer or a deploy lands
 * back on the right step with the right L1).
 */

import type { RunInfo } from "./run-store";
import { isValidAmount, isValidChainId, isValidL1Name, isValidToken } from "./validators";

export type FujiStep = "fund" | "transfer" | "deploy" | "live";
export const FUJI_STEPS: FujiStep[] = ["fund", "transfer", "deploy", "live"];

export interface FujiForm {
  name: string;
  chainId: string;
  token: string;
  amount: string;
}

/** Which of the form's values the server would accept; `ok` when all four are. */
export interface FujiFormCheck {
  name: boolean;
  chainId: boolean;
  token: boolean;
  amount: boolean;
  ok: boolean;
}

/**
 * Check the whole configuration against the server's rules. The wizard only
 * moves on (and only spends testnet AVAX on the C→P transfer) when all four
 * values pass: a chain ID or token the deploy would refuse must be caught
 * before the transfer, not after it.
 */
export function checkFujiForm(form: FujiForm): FujiFormCheck {
  const name = isValidL1Name(form.name);
  const chainId = isValidChainId(form.chainId);
  const token = isValidToken(form.token);
  const amount = isValidAmount(form.amount);
  return { name, chainId, token, amount, ok: name && chainId && token && amount };
}

const RULES: [keyof FujiForm, string][] = [
  ["name", "name: 2–32 lowercase letters or digits, starting with a letter"],
  ["chainId", "chain ID: a whole number from 1 to 4294967295"],
  ["token", "token: 1–8 upper-case letters or digits, starting with a letter"],
  ["amount", "amount: more than 0 and at most 1000 AVAX"],
];

/** The rule behind every value the server would refuse (empty when all four pass). */
export function fujiFormProblems(form: FujiForm): string[] {
  const check = checkFujiForm(form);
  return RULES.filter(([field]) => !check[field]).map(([, rule]) => rule);
}

/**
 * The last step in which each value can still be changed: until the action
 * that uses it has run. The name is the key's name, so it is fixed once the
 * key is funded (Start over to change it); the amount is fixed by the
 * transfer; the chain ID and token are only used by the deploy, so a deploy
 * the server refused can be corrected on the spot — no second transfer.
 */
const EDITABLE_THROUGH: Record<keyof FujiForm, FujiStep> = {
  name: "fund",
  amount: "transfer",
  chainId: "deploy",
  token: "deploy",
};

/** Whether `field` can still be edited on `step` (never while an action is in flight). */
export function canEditFujiField(step: FujiStep, field: keyof FujiForm): boolean {
  return FUJI_STEPS.indexOf(step) <= FUJI_STEPS.indexOf(EDITABLE_THROUGH[field]);
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
      // A value is fixed once the action that uses it has run.
      if (!canEditFujiField(state.step, action.field)) return state;
      if (state.form[action.field] === action.value) return state;
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
      // Not with a configuration the server would refuse later on.
      return state.step === "fund" && state.address && checkFujiForm(state.form).ok
        ? { ...state, step: "transfer" }
        : state;

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
