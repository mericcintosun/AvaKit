import { readContract } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { Abi, Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContract } from "./hooks.js";
import { AvaKitProvider } from "./provider.js";

// Chain reads are replaced, so no RPC request ever leaves the test.
vi.mock("@avakit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avakit/core")>();
  return {
    ...actual,
    readContract: vi.fn(async () => 7n),
  };
});

const TOKEN = "0x00000000000000000000000000000000000000b0" as Address;
const OTHER_TOKEN = "0x00000000000000000000000000000000000000c0" as Address;

const abi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AvaKitProvider chains={[fuji]} adapters={[]}>
      {children}
    </AvaKitProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useContract", () => {
  it("returns the same object while the contract, chain and wallet are unchanged", () => {
    const { result, rerender } = renderHook(({ address }) => useContract({ address, abi }), {
      wrapper,
      initialProps: { address: TOKEN },
    });
    const first = result.current;

    rerender({ address: TOKEN });
    rerender({ address: TOKEN });

    expect(result.current).toBe(first);
    expect(result.current.read).toBe(first.read);
    expect(result.current.write).toBe(first.write);
  });

  it("returns a new object when it is bound to another contract", () => {
    const { result, rerender } = renderHook(({ address }) => useContract({ address, abi }), {
      wrapper,
      initialProps: { address: TOKEN },
    });
    const first = result.current;

    rerender({ address: OTHER_TOKEN });

    expect(result.current).not.toBe(first);
  });

  // The pattern the erc20-token, nft-mint and token-gated-app templates use: a
  // refresh callback that depends on the contract object, run from an effect.
  // While that object was new on every render, the effect fired after every
  // render and re-read the contract over the public RPC each time.
  it("lets an effect depend on the contract without re-reading on every render", async () => {
    function TokenPanel() {
      const token = useContract({ address: TOKEN, abi });
      const [supply, setSupply] = useState<bigint | null>(null);
      const [renders, setRenders] = useState(0);

      const refresh = useCallback(async () => {
        setSupply((await token.read("totalSupply")) as bigint);
      }, [token]);

      useEffect(() => {
        void refresh();
      }, [refresh]);

      return (
        <div>
          <span data-testid="supply">{supply === null ? "…" : supply.toString()}</span>
          <button type="button" onClick={() => setRenders((n) => n + 1)}>
            unrelated update {renders}
          </button>
        </div>
      );
    }

    render(<TokenPanel />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("supply").textContent).toBe("7");
    });

    // Unrelated state updates (a busy flag, an error message) re-render the panel.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button"));
      });
    }

    expect(screen.getByRole("button").textContent).toBe("unrelated update 3");
    expect(readContract).toHaveBeenCalledTimes(1);
  });
});
