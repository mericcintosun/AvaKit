import {
  type AvaChain,
  DeployFailedError,
  defineChain,
  deployContract,
  FaucetError,
  getBalance,
  getWalletClient,
  readContract,
  requestFaucet,
  type WalletAdapter,
} from "@avakit/core";
import { cChain, fuji } from "@avakit/core/chains";
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
import type { Abi, Address, EIP1193Provider, Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAvaDeploy, useBalance, useContract, useFaucet, useSendTransaction } from "./hooks.js";
import { AvaKitProvider, useAvaKit } from "./provider.js";
import { TransactionButton } from "./transaction-button.js";

// Chain reads, the wallet client, deployments and the faucet are replaced, so no
// request ever leaves the test.
vi.mock("@avakit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avakit/core")>();
  return {
    ...actual,
    readContract: vi.fn(async () => 7n),
    getBalance: vi.fn(),
    getWalletClient: vi.fn(),
    deployContract: vi.fn(),
    requestFaucet: vi.fn(),
    ensureChain: vi.fn(async () => {}),
  };
});

const TOKEN = "0x00000000000000000000000000000000000000b0" as Address;
const OTHER_TOKEN = "0x00000000000000000000000000000000000000c0" as Address;
const HOLDER = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_HOLDER = "0x00000000000000000000000000000000000000A1" as Address;
const TX_HASH = `0x${"ab".repeat(32)}` as const;

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

/** A wallet that connects at once as HOLDER; its provider is never really asked. */
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

/** Render a hook under a provider whose mock wallet is already connected. */
async function renderConnected<T>(
  useHook: () => T,
  options: { chain?: AvaChain; faucetUrl?: string } = {},
) {
  const adapters = [mockWallet()];
  const chains = [options.chain ?? fuji];
  const view = renderHook(() => ({ kit: useAvaKit(), hook: useHook() }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AvaKitProvider chains={chains} adapters={adapters} faucetUrl={options.faucetUrl}>
        {children}
      </AvaKitProvider>
    ),
  });
  await act(async () => {
    await view.result.current.kit.connect();
  });
  expect(view.result.current.kit.status).toBe("connected");
  return view;
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

  it("reads the bound contract on the active chain", async () => {
    const { result } = renderHook(() => useContract({ address: TOKEN, abi }), { wrapper });

    await expect(result.current.read("totalSupply")).resolves.toBe(7n);

    expect(readContract).toHaveBeenCalledWith(fuji, {
      address: TOKEN,
      abi,
      functionName: "totalSupply",
      args: undefined,
    });
  });

  it("writes from the connected account through a wallet client for the active chain", async () => {
    const writeContract = vi.fn(async () => TX_HASH);
    vi.mocked(getWalletClient).mockReturnValue({
      writeContract,
    } as unknown as ReturnType<typeof getWalletClient>);
    const { result } = await renderConnected(() => useContract({ address: TOKEN, abi }));

    await expect(result.current.hook.write("mint", [1n])).resolves.toBe(TX_HASH);

    expect(getWalletClient).toHaveBeenCalledWith(fuji, result.current.kit.provider);
    expect(writeContract).toHaveBeenCalledWith({
      address: TOKEN,
      abi,
      functionName: "mint",
      args: [1n],
      account: HOLDER,
    });
  });

  it("refuses to write without a connected wallet", async () => {
    const { result } = renderHook(() => useContract({ address: TOKEN, abi }), { wrapper });

    await expect(result.current.write("mint", [])).rejects.toThrow(/Connect a wallet/);

    expect(getWalletClient).not.toHaveBeenCalled();
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

  it("is pending while the wallet is asked, then reports the hash once it is broadcast", async () => {
    let approve: (hash: Hex) => void = () => {};
    const sendTransaction = vi.fn(
      () =>
        new Promise<Hex>((resolve) => {
          approve = resolve;
        }),
    );
    vi.mocked(getWalletClient).mockReturnValue({
      sendTransaction,
    } as unknown as ReturnType<typeof getWalletClient>);
    const { result } = await renderConnected(() => useSendTransaction());
    expect(result.current.hook.status).toBe("idle");

    let sending: Promise<Hex> = Promise.resolve(TX_HASH);
    act(() => {
      sending = result.current.hook.send({ to: OTHER_HOLDER, value: 1n });
    });
    expect(result.current.hook.status).toBe("pending");
    expect(result.current.hook.isPending).toBe(true);
    expect(result.current.hook.hash).toBeNull();

    await act(async () => {
      approve(TX_HASH);
      await sending;
    });

    await expect(sending).resolves.toBe(TX_HASH);
    expect(result.current.hook.status).toBe("success");
    expect(result.current.hook.isPending).toBe(false);
    expect(result.current.hook.hash).toBe(TX_HASH);
    expect(result.current.hook.explorerUrl).toBe(`${fuji.explorerUrl}/tx/${TX_HASH}`);
    // Sent from the connected account, through a wallet client for the active chain.
    expect(getWalletClient).toHaveBeenCalledWith(fuji, result.current.kit.provider);
    expect(sendTransaction).toHaveBeenCalledWith({
      account: HOLDER,
      to: OTHER_HOLDER,
      value: 1n,
      data: undefined,
    });
  });

  it("keeps the wallet's error, rejects with it, and can be reset", async () => {
    const failure = new Error("User rejected the request.");
    vi.mocked(getWalletClient).mockReturnValue({
      sendTransaction: vi.fn(async () => {
        throw failure;
      }),
    } as unknown as ReturnType<typeof getWalletClient>);
    const { result } = await renderConnected(() => useSendTransaction());

    await act(async () => {
      await expect(result.current.hook.send({ to: OTHER_HOLDER })).rejects.toBe(failure);
    });

    expect(result.current.hook.status).toBe("error");
    expect(result.current.hook.error).toBe(failure);
    expect(result.current.hook.hash).toBeNull();
    expect(result.current.hook.explorerUrl).toBeNull();

    act(() => result.current.hook.reset());

    expect(result.current.hook.status).toBe("idle");
    expect(result.current.hook.error).toBeNull();
  });

  it("refuses to send without a connected wallet", async () => {
    const { result } = renderHook(() => useSendTransaction(), { wrapper });

    await expect(result.current.send({ to: OTHER_HOLDER })).rejects.toThrow(/Connect a wallet/);

    expect(result.current.status).toBe("idle");
    expect(getWalletClient).not.toHaveBeenCalled();
  });
});

describe("useAvaDeploy", () => {
  const artifact = { abi, bytecode: "0x6080" } as const;
  const deployed = {
    address: TOKEN,
    txHash: TX_HASH,
    explorerUrl: `${fuji.explorerUrl}/address/${TOKEN}`,
  };

  it("deploys from the connected account on the active chain and reports the result", async () => {
    vi.mocked(deployContract).mockResolvedValue(deployed);
    const { result } = await renderConnected(() => useAvaDeploy());
    expect(result.current.hook.status).toBe("idle");

    await act(async () => {
      await expect(result.current.hook.deploy(artifact, ["Demo"])).resolves.toEqual(deployed);
    });

    expect(result.current.hook.status).toBe("success");
    expect(result.current.hook.result).toEqual(deployed);
    expect(result.current.hook.error).toBeNull();
    expect(deployContract).toHaveBeenCalledWith({
      artifact,
      args: ["Demo"],
      chain: fuji,
      provider: result.current.kit.provider,
      account: HOLDER,
      confirmMainnet: undefined,
    });
  });

  // The mainnet opt-in is the caller's to give; the hook must hand it on, and
  // must not invent it.
  it("passes confirmMainnet through to the core deploy, only when given", async () => {
    vi.mocked(deployContract).mockResolvedValue(deployed);
    const { result } = await renderConnected(() => useAvaDeploy(), { chain: cChain });

    await act(async () => {
      await result.current.hook.deploy(artifact);
    });
    expect(deployContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ chain: cChain, confirmMainnet: undefined }),
    );

    await act(async () => {
      await result.current.hook.deploy(artifact, undefined, { confirmMainnet: true });
    });
    expect(deployContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ chain: cChain, confirmMainnet: true }),
    );
  });

  it("reports a failed deployment through status and error, and rejects with it", async () => {
    const failure = new DeployFailedError("Deployment transaction reverted.");
    vi.mocked(deployContract).mockRejectedValue(failure);
    const { result } = await renderConnected(() => useAvaDeploy());

    await act(async () => {
      await expect(result.current.hook.deploy(artifact)).rejects.toBe(failure);
    });

    expect(result.current.hook.status).toBe("error");
    expect(result.current.hook.error).toBe(failure);
    expect(result.current.hook.result).toBeNull();
  });

  it("refuses to deploy without a connected wallet", async () => {
    const { result } = renderHook(() => useAvaDeploy(), { wrapper });

    await expect(result.current.deploy(artifact)).rejects.toThrow(/Connect a wallet/);

    expect(result.current.status).toBe("idle");
    expect(deployContract).not.toHaveBeenCalled();
  });
});

describe("useFaucet", () => {
  const FAUCET_URL = "https://faucet.example/drip";

  it("is disabled, and refuses to fund, when the provider has no faucetUrl", async () => {
    const { result } = await renderConnected(() => useFaucet());

    expect(result.current.hook.enabled).toBe(false);
    await expect(result.current.hook.fund()).rejects.toThrow(/No faucetUrl/);
    expect(requestFaucet).not.toHaveBeenCalled();
  });

  it("asks the app's faucet to fund the connected account on the active chain", async () => {
    const drip = { txHash: TX_HASH, amount: "0.5" } as const;
    vi.mocked(requestFaucet).mockResolvedValue(drip);
    const { result } = await renderConnected(() => useFaucet(), { faucetUrl: FAUCET_URL });
    expect(result.current.hook.enabled).toBe(true);
    // Only a burner is funded automatically on connect; a real wallet asks.
    expect(requestFaucet).not.toHaveBeenCalled();

    await act(async () => {
      await expect(result.current.hook.fund()).resolves.toEqual(drip);
    });

    expect(requestFaucet).toHaveBeenCalledTimes(1);
    expect(requestFaucet).toHaveBeenCalledWith({
      url: FAUCET_URL,
      address: HOLDER,
      chainId: fuji.id,
    });
    expect(result.current.hook.status).toBe("success");
    expect(result.current.hook.result).toEqual(drip);
    expect(result.current.hook.isFunding).toBe(false);
  });

  it("funds the address it is given instead of the connected account", async () => {
    vi.mocked(requestFaucet).mockResolvedValue({});
    const { result } = await renderConnected(() => useFaucet(), { faucetUrl: FAUCET_URL });

    await act(async () => {
      await result.current.hook.fund(OTHER_HOLDER);
    });

    expect(requestFaucet).toHaveBeenCalledWith({
      url: FAUCET_URL,
      address: OTHER_HOLDER,
      chainId: fuji.id,
    });
  });

  it("reports the faucet's refusal through status and error, and rejects with it", async () => {
    const refusal = new FaucetError("Rate limited. Try again later.", 429);
    vi.mocked(requestFaucet).mockRejectedValue(refusal);
    const { result } = await renderConnected(() => useFaucet(), { faucetUrl: FAUCET_URL });

    await act(async () => {
      await expect(result.current.hook.fund()).rejects.toBe(refusal);
    });

    expect(result.current.hook.status).toBe("error");
    expect(result.current.hook.error).toBe(refusal);
    expect(result.current.hook.result).toBeNull();
  });

  it("needs an address: the connected account, or one passed in", async () => {
    const { result } = renderHook(() => useFaucet(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AvaKitProvider chains={[fuji]} adapters={[]} faucetUrl={FAUCET_URL}>
          {children}
        </AvaKitProvider>
      ),
    });

    await expect(result.current.fund()).rejects.toThrow(/Connect a wallet \(or pass an address\)/);
    expect(requestFaucet).not.toHaveBeenCalled();
  });
});
