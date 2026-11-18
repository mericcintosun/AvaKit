import { useCallback, useEffect, useReducer, useState } from "react";
import { fujiApi } from "../api";
import { useToast } from "../components/toast";
import {
  type FujiForm,
  type FujiWizardState,
  fujiWizardReducer,
  initialFujiWizard,
} from "../lib/fuji-wizard";
import type { RunInfo } from "../lib/run-store";

const BALANCE_POLL_MS = 5000;
const L1_POLL_MS = 3000;
const L1_POLL_TRIES = 20;

export interface FujiWizard {
  state: FujiWizardState;
  edit: (field: keyof FujiForm, value: string) => void;
  createKey: () => Promise<void>;
  creatingKey: boolean;
  /** The key is funded: move on to the C→P transfer. */
  next: () => void;
  /** Still waiting for avalanche-cli to record the deployed L1 and for its RPC to answer. */
  checkingL1: boolean;
  recheckL1: () => void;
  /** Back to step 1, keeping the configuration. */
  reset: () => void;
}

/**
 * The "Launch on Fuji" wizard. Called in App — above the view switch — so the
 * step, the key and the form survive leaving the view, and fed the server's
 * current run so it lands on the right step after a reload. `visible` says
 * whether the wizard is on screen: its polling (the Fuji RPC behind the balance)
 * only runs while someone is looking.
 */
export function useFujiWizard(run: RunInfo | null, visible: boolean): FujiWizard {
  const toast = useToast();
  const [state, dispatch] = useReducer(fujiWizardReducer, initialFujiWizard);
  const [creatingKey, setCreatingKey] = useState(false);
  const [l1Attempt, setL1Attempt] = useState(0);
  const [l1GaveUp, setL1GaveUp] = useState(false);

  const { step, address } = state;
  const { name } = state.form;
  const l1Running = state.l1?.running ?? false;

  // Mirror the server's Fuji runs: started here, in another tab, or before a reload.
  useEffect(() => {
    if (run?.kind === "fuji") dispatch({ type: "run", run });
  }, [run]);

  // Poll the key's C-Chain balance while on the funding step. The reducer drops
  // an answer that belongs to a name (or a key) that is no longer on screen.
  useEffect(() => {
    if (!visible || step !== "fund" || !address) return;
    let active = true;
    const tick = async () => {
      try {
        const balance = await fujiApi.balance(name);
        if (active) dispatch({ type: "balance", name, balance });
      } catch {
        if (active) {
          dispatch({
            type: "balance",
            name,
            balance: { address, cBalance: "0", error: "Studio did not answer" },
          });
        }
      }
    };
    void tick();
    const timer = setInterval(tick, BALANCE_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [visible, step, address, name]);

  // After a deploy, wait for avalanche-cli to record the L1 and for it to answer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: l1Attempt re-runs the check on demand
  useEffect(() => {
    if (!visible || step !== "live" || l1Running) return;
    let active = true;
    setL1GaveUp(false);
    void (async () => {
      for (let i = 0; i < L1_POLL_TRIES && active; i++) {
        try {
          const l1 = await fujiApi.l1(name);
          if (!active) return;
          if (l1.deployed) {
            dispatch({ type: "l1", name, l1 });
            if (l1.running) return;
          }
        } catch {
          // Studio did not answer — try again
        }
        await new Promise((r) => setTimeout(r, L1_POLL_MS));
      }
      if (active) setL1GaveUp(true);
    })();
    return () => {
      active = false;
    };
  }, [visible, step, name, l1Running, l1Attempt]);

  const edit = useCallback((field: keyof FujiForm, value: string) => {
    dispatch({ type: "edit", field, value });
  }, []);

  const createKey = useCallback(async () => {
    setCreatingKey(true);
    try {
      const key = await fujiApi.createKey(name);
      // Tagged with the name it was requested for: if the name was edited
      // meanwhile, the reducer ignores it rather than show another key's address.
      dispatch({ type: "key", name, address: key.address });
      if (!key.address) {
        toast({ title: "Key error", description: "Could not create the key.", variant: "error" });
      }
    } catch (e) {
      toast({
        title: "Key error",
        description: e instanceof Error ? e.message : "failed",
        variant: "error",
      });
    } finally {
      setCreatingKey(false);
    }
  }, [name, toast]);

  const next = useCallback(() => dispatch({ type: "funded" }), []);
  const recheckL1 = useCallback(() => setL1Attempt((n) => n + 1), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return {
    state,
    edit,
    createKey,
    creatingKey,
    next,
    checkingL1: step === "live" && !l1Running && !l1GaveUp,
    recheckL1,
    reset,
  };
}
