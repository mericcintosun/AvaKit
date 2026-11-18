import {
  defineChain,
  getBalance,
  getWalletClient,
  readContract,
  type WalletAdapter,
} from "@avakit/core";
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
import type { Abi, Address, EIP1193Provider } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBalance, useContract } from "./hooks.js";
import { AvaKitProvider, useAvaKit } from "./provider.js";
import { TransactionButton } from "./transaction-button.js";

// Chain reads and the wallet client are replaced, so no RPC request ever leaves
// the test.
vi.mock("@avakit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avakit/core")>();
  return {
    ...actual,
    readContract: vi.fn(async () => 7n),
    getBalance: vi.fn(),
    getWalletClient: vi.fn(),
    ensureChain: vi.fn(async () => {}),
  };
});

const TOKEN = "0x00000000000000000000000000000000000000b0" as Address;
const OTHER_TOKEN = "0x00000000000000000000000000000000000000c0" as Address;
const HOLDER = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_HOLDER = "0x00000000000000000000000000000000000000A1" as Address;

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

describe("useBalance", () => {
  it("reports a failed read through error instead of rejecting", async () => {
    vi.mocked(getBalance).mockRejectedValue(new Error("RPC unreachable"));
    const { result } = renderHook(() => useBalance(HOLDER), { wrapper });

    await waitFor(() => {
      expect(result.current.error?.message).toBe("RPC unreachable");
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);

    // refetch() is called from effects and polling timers; it must not reject.
    await act(async () => {
      await expect(result.current.refetch()).resolves.toBeUndefined();
    });

    vi.mocked(getBalance).mockResolvedValue(5n);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toBe(5n);
    expect(result.current.error).toBeNull();
  });

  it("never shows one account's balance for another", async () => {
    let releaseFirst: (balance: bigint) => void = () => {};
    let releaseSecond: (balance: bigint) => void = () => {};
    vi.mocked(getBalance).mockImplementation(
      (address) =>
        new Promise<bigint>((resolve) => {
          if (address === HOLDER) releaseFirst = resolve;
          else releaseSecond = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ holder }) => useBalance(holder), {
      wrapper,
      initialProps: { holder: HOLDER },
    });
    await act(async () => {
      releaseFirst(111n);
    });
    expect(result.current.data).toBe(111n);

    // The wallet switches account: the old balance must not sit next to the new address.
    rerender({ holder: OTHER_HOLDER });
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);

    // A late answer for the previous account arrives after the switch…
    rerender({ holder: HOLDER });
    rerender({ holder: OTHER_HOLDER });
    await act(async () => {
      releaseFirst(999n);
    });
    expect(result.current.data).toBeNull();

    // …and only the current account's answer is shown.
    await act(async () => {
      releaseSecond(222n);
    });
    expect(result.current.data).toBe(222n);
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps the balance on screen while the same account is refetched", async () => {
    vi.mocked(getBalance).mockResolvedValue(5n);
    const { result } = renderHook(() => useBalance(HOLDER), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toBe(5n);
    });

    let release: (balance: bigint) => void = () => {};
    vi.mocked(getBalance).mockImplementation(
      () =>
        new Promise<bigint>((resolve) => {
          release = resolve;
        }),
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.refetch();
    });
    // Polling the same account does not blank the number.
    expect(result.current.data).toBe(5n);

    await act(async () => {
      release(6n);
      await pending;
    });
    expect(result.current.data).toBe(6n);
  });
});

describe("useSendTransaction", () => {
  const TX_HASH = `0x${"ab".repeat(32)}` as const;

  /** A connected wallet whose client "sends" by returning a fixed hash. */
  function ConnectedButton() {
    const { status, connect } = useAvaKit();
    return (
      <div>
        <span data-testid="status">{status}</span>
        <button type="button" onClick={() => void connect()}>
          connect
        </button>
        <TransactionButton to={OTHER_HOLDER}>Send</TransactionButton>
      </div>
    );
  }

  function mockWallet(): WalletAdapter {
    const provider = { request: vi.fn(async () => null) } as unknown as EIP1193Provider;
    return {
      id: "mock",
      name: "Mock Wallet",
      isAvailable: () => true,
      connect: async () => ({ address: HOLDER, provider }),
      disconnect: async () => {},
      getProvider: () => provider,
      switchChain: async () => {},
    };
  }

  async function sendOn(chain: typeof fuji) {
    vi.mocked(getWalletClient).mockReturnValue({
      sendTransaction: vi.fn(async () => TX_HASH),
    } as unknown as ReturnType<typeof getWalletClient>);
    render(
      <AvaKitProvider chains={[chain]} adapters={[mockWallet()]}>
        <ConnectedButton />
      </AvaKitProvider>,
    );
    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Send"));
    });
  }

  it("links the sent transaction to the chain's explorer", async () => {
    await sendOn(fuji);

    const link = await screen.findByRole("link", { name: /View on explorer/ });
    expect(link.getAttribute("href")).toBe(`${fuji.explorerUrl}/tx/${TX_HASH}`);
  });

  // A fresh L1 has no explorer. The link used to be built anyway, as the
  // relative URL "/tx/0x…", which points back into the app.
  it("offers no explorer link on a chain without an explorer", async () => {
    const freshL1 = defineChain({
      id: 1001,
      name: "Fresh L1",
      rpcUrl: "http://127.0.0.1:9650/ext/bc/fresh/rpc",
      explorerUrl: "",
      nativeCurrency: { name: "Fresh", symbol: "FRSH", decimals: 18 },
      testnet: true,
    });

    await sendOn(freshL1);

    expect(vi.mocked(getWalletClient).mock.results[0]?.value.sendTransaction).toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
