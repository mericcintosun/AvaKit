/**
 * Remember a contract that was deployed from this browser.
 *
 * The address is kept in localStorage so a reload does not send the user back
 * to the deploy step — but a remembered address is only ever *used* after the
 * chain confirms there is still bytecode at it:
 *
 * - The storage key includes the chain id and the RPC URL. A local devnet keeps
 *   its chain id across a reset but gets a new RPC URL (and none of the old
 *   contracts), so an address from before the reset simply stops matching.
 * - Before a remembered address is handed to the UI, `eth_getCode` must return
 *   bytecode. If there is none, the UI gets `null` and shows its deploy step
 *   again. If the RPC cannot be reached, the answer is "unreachable" — which is
 *   not the same as "nothing deployed" — so the UI can say so and try again.
 */

import { getPublicClient } from "@avakit/core";
import type { AvaChain } from "@avakit/core/chains";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, isAddress } from "viem";

export type DeployedContractStatus = "checking" | "ready" | "unreachable";

export interface DeployedContract {
  /** The verified contract address, or null when there is none to use. */
  address: Address | null;
  /**
   * "checking" while a remembered address is being verified, "ready" once
   * `address` is final, "unreachable" when the chain's RPC did not answer.
   */
  status: DeployedContractStatus;
  /** Remember a contract that was just deployed on this chain. */
  remember: (address: Address) => void;
  /** Forget it, so the UI returns to its deploy step. Nothing changes on-chain. */
  forget: () => void;
  /** Verify the remembered address again (after "unreachable"). */
  recheck: () => void;
}

function readStored(key: string): Address | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && isAddress(value) ? value : null;
  } catch {
    return null; // storage is unavailable (private mode, blocked site data)
  }
}

function writeStored(key: string, address: Address | null): void {
  try {
    if (address) window.localStorage.setItem(key, address);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage is unavailable: the address still lives in state for this session.
  }
}

/**
 * @param name  A stable name for this contract's slot, e.g. `"my-app:token"`.
 * @param chain The chain the contract lives on.
 */
export function useDeployedContract(name: string, chain: AvaChain): DeployedContract {
  const key = `${name}:${chain.id}:${chain.rpcUrl}`;
  const [state, setState] = useState<Pick<DeployedContract, "address" | "status">>({
    address: null,
    status: "checking",
  });
  const [attempt, setAttempt] = useState(0);
  // Identifies the newest check, so an answer for an older one (another chain,
  // or from before a remember/forget) is ignored.
  const latestCheck = useRef(0);

  // `attempt` is not read below: it is a dependency so recheck() re-runs this.
  useEffect(() => {
    const check = ++latestCheck.current;
    const stored = readStored(key);
    if (!stored) {
      setState({ address: null, status: "ready" });
      return;
    }
    setState({ address: null, status: "checking" });
    getPublicClient(chain)
      .getCode({ address: stored })
      .then((code) => {
        if (check !== latestCheck.current) return;
        // No bytecode: the chain was reset, or the address belongs to another
        // network. The entry stays in storage (the next deploy overwrites it)
        // but it is never used.
        setState({ address: code && code !== "0x" ? stored : null, status: "ready" });
      })
      .catch(() => {
        if (check === latestCheck.current) setState({ address: null, status: "unreachable" });
      });
    return () => {
      latestCheck.current++;
    };
  }, [key, chain, attempt]);

  const remember = useCallback(
    (address: Address) => {
      latestCheck.current++;
      writeStored(key, address);
      setState({ address, status: "ready" });
    },
    [key],
  );

  const forget = useCallback(() => {
    latestCheck.current++;
    writeStored(key, null);
    setState({ address: null, status: "ready" });
  }, [key]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, remember, forget, recheck };
}
