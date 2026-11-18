import {
  type AvaChain,
  burnerAdapter,
  type WalletAdapter,
  type WalletConnection,
} from "@avakit/core";
import { cChain, fuji } from "@avakit/core/chains";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Address, EIP1193Provider } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectAvalanche } from "./connect-avalanche.js";
import { useAvaAccount, useBalance } from "./hooks.js";
import { AvaKitProvider, useAvaKit } from "./provider.js";

// Keep every network-touching core export stubbed so no real RPC is ever made.
// `getBalance` is exercised by the useBalance test; the rest are preserved.
vi.mock("@avakit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avakit/core")>();
  return {
    ...actual,
    getBalance: vi.fn(async () => 1_000n),
    ensureChain: vi.fn(async () => {}),
  };
});

const TEST_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

/** A tiny stand-in for an EIP-1193 provider — never actually called in tests. */
function fakeProvider(): EIP1193Provider {
  return {
    request: vi.fn(async () => null),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as EIP1193Provider;
}

/** In-memory wallet adapter: resolves instantly, never hits the network. */
function makeMockAdapter(overrides: Partial<WalletAdapter> = {}): WalletAdapter {
  const provider = fakeProvider();
  return {
    id: "mock",
    name: "Mock Wallet",
    isAvailable: () => true,
    connect: vi.fn(async (): Promise<WalletConnection> => ({ address: TEST_ADDRESS, provider })),
    disconnect: vi.fn(async () => {}),
    getProvider: () => provider,
    // No-op switch so the provider's post-connect chain sync never hits RPC.
    switchChain: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function AccountProbe() {
  const { status, connect, disconnect } = useAvaKit();
  const { address, isConnected } = useAvaAccount();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="address">{address ?? "none"}</span>
      <span data-testid="connected">{String(isConnected)}</span>
      <button type="button" onClick={() => void connect()}>
        connect
      </button>
      <button type="button" onClick={() => void disconnect()}>
        disconnect
      </button>
    </div>
  );
}

describe("AvaKitProvider + useAvaKit", () => {
  it("throws when useAvaKit is used outside the provider", () => {
    function Orphan() {
      useAvaKit();
      return null;
    }
    // Silence the React error boundary console noise for this expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/within <AvaKitProvider>/);
    spy.mockRestore();
  });

  it("starts disconnected and exposes the address after connecting", async () => {
    const adapter = makeMockAdapter();
    render(
      <AvaKitProvider chains={[fuji]} adapters={[adapter]}>
        <AccountProbe />
      </AvaKitProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("disconnected");
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(screen.getByTestId("connected").textContent).toBe("false");

    fireEvent.click(screen.getByText("connect"));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("address").textContent).toBe(TEST_ADDRESS);
    expect(screen.getByTestId("connected").textContent).toBe("true");
    expect(adapter.connect).toHaveBeenCalledTimes(1);
    // Post-connect chain sync uses the adapter's own switchChain, not the RPC path.
    await waitFor(() => {
      expect(adapter.switchChain).toHaveBeenCalledWith(fuji);
    });
  });

  it("returns to disconnected and clears the address after disconnecting", async () => {
    const adapter = makeMockAdapter();
    render(
      <AvaKitProvider chains={[fuji]} adapters={[adapter]}>
        <AccountProbe />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });

    fireEvent.click(screen.getByText("disconnect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });
});

/** Shows the active chain, adapter and error, and drives chain / burner actions. */
function ChainProbe({ next }: { next: AvaChain }) {
  const { chain, setChain, error, activeAdapterId, connect } = useAvaKit();
  return (
    <div>
      <span data-testid="chain">{chain.name}</span>
      <span data-testid="adapter">{activeAdapterId ?? "none"}</span>
      <span data-testid="error">{error?.message ?? "none"}</span>
      <button type="button" onClick={() => setChain(next)}>
        switch chain
      </button>
      <button type="button" onClick={() => void connect("burner")}>
        connect burner
      </button>
    </div>
  );
}

// The burner keeps its key in localStorage in the clear, so it is testnet-only.
// The adapter only knows the chain it was created with; the provider has to
// enforce the rule for the chain the app is actually on. (audit A8)
describe("burner wallet on a mainnet chain", () => {
  it("refuses to connect a burner while the app is on a mainnet", async () => {
    const burner = makeMockAdapter({ id: "burner", name: "Temporary wallet" });
    render(
      <AvaKitProvider chains={[cChain]} adapters={[burner]}>
        <AccountProbe />
        <ChainProbe next={cChain} />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect burner"));
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toMatch(/testnet-only/);
    });
    expect(screen.getByTestId("error").textContent).toContain(cChain.name);
    expect(burner.connect).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("disconnected");

    // The default connect() picks the first adapter — still the burner, still refused.
    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toMatch(/testnet-only/);
    });
    expect(burner.connect).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("disconnected");
  });

  it("disconnects an active burner when the chain becomes a mainnet", async () => {
    const burner = makeMockAdapter({ id: "burner", name: "Temporary wallet" });
    render(
      <AvaKitProvider chains={[fuji, cChain]} adapters={[burner]}>
        <AccountProbe />
        <ChainProbe next={cChain} />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect burner"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("adapter").textContent).toBe("burner");

    fireEvent.click(screen.getByText("switch chain"));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("chain").textContent).toBe(cChain.name);
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(screen.getByTestId("adapter").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toMatch(/testnet-only/);
    expect(burner.disconnect).toHaveBeenCalledTimes(1);
    // The burner was never asked to move to the mainnet.
    expect(burner.switchChain).not.toHaveBeenCalledWith(cChain);
  });

  it("keeps the real burnerAdapter() out of a mainnet-only app", async () => {
    // burnerAdapter() defaults to Fuji, so its own connect() guard passes here.
    render(
      <AvaKitProvider chains={[cChain]} adapters={[burnerAdapter({ persist: false })]}>
        <AccountProbe />
        <ChainProbe next={cChain} />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect burner"));
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toMatch(/testnet-only/);
    });
    expect(screen.getByTestId("status").textContent).toBe("disconnected");
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(screen.getByTestId("adapter").textContent).toBe("none");
  });

  it("drops the real burnerAdapter() when the app switches from Fuji to mainnet", async () => {
    render(
      <AvaKitProvider chains={[fuji, cChain]} adapters={[burnerAdapter({ persist: false })]}>
        <AccountProbe />
        <ChainProbe next={cChain} />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect burner"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("address").textContent).toMatch(/^0x[0-9a-fA-F]{40}$/);

    fireEvent.click(screen.getByText("switch chain"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toMatch(/testnet-only/);
  });

  // A chain defined in plain JavaScript or JSON can lack the `testnet` flag.
  // That must read as a mainnet (fail closed), and the refusal has to say why.
  it("treats a chain without a testnet flag as a mainnet, and says so", async () => {
    const { testnet: _omitted, ...withoutFlag } = fuji;
    const unflagged = { ...withoutFlag, id: 99_999, name: "Unflagged L1" } as AvaChain;
    const adapter = burnerAdapter({ persist: false, chain: fuji });
    render(
      <AvaKitProvider chains={[unflagged]} adapters={[adapter]}>
        <AccountProbe />
        <ChainProbe next={unflagged} />
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect burner"));
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toMatch(/testnet-only/);
    });
    expect(screen.getByTestId("error").textContent).toMatch(
      /^Unflagged L1 has no boolean `testnet` flag/,
    );
    expect(screen.getByTestId("status").textContent).toBe("disconnected");

    // …and the connect dialog does not offer the burner there either.
    fireEvent.click(screen.getByText("Connect wallet"));
    expect(await screen.findByText(/temporary wallet is testnet-only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start instantly/i })).toBeNull();
  });

  it("leaves real wallets alone on a mainnet", async () => {
    const injected = makeMockAdapter({ id: "injected", name: "Browser Wallet" });
    render(
      <AvaKitProvider chains={[cChain]} adapters={[injected]}>
        <AccountProbe />
        <ChainProbe next={cChain} />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("error").textContent).toBe("none");
    await waitFor(() => {
      expect(injected.switchChain).toHaveBeenCalledWith(cChain);
    });
  });
});

const OTHER_ADDRESS = "0x00000000000000000000000000000000000000A1" as Address;

/**
 * An EIP-1193 provider with a working event API, standing in for a browser
 * wallet. `emit` plays the wallet's side: the user switching account or network,
 * locking the wallet, or the session ending.
 */
function eventedWallet(initialAccounts: Address[] = [TEST_ADDRESS]) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let accounts = initialAccounts;
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) =>
      method === "eth_accounts" ? accounts : null,
    ),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    }),
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
  };
  return {
    provider: provider as unknown as EIP1193Provider,
    setAccounts(next: Address[]) {
      accounts = next;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(...args);
      }
    },
    listenerCount() {
      let count = 0;
      for (const set of listeners.values()) count += set.size;
      return count;
    },
  };
}

/** Connect `wallet` through a mock adapter and wait until the provider reports it. */
async function renderConnected(
  wallet: ReturnType<typeof eventedWallet>,
  options: { chains?: AvaChain[]; adapter?: Partial<WalletAdapter> } = {},
) {
  const adapter = makeMockAdapter({
    id: "injected",
    name: "Browser Wallet",
    connect: vi.fn(
      async (): Promise<WalletConnection> => ({ address: TEST_ADDRESS, provider: wallet.provider }),
    ),
    getProvider: () => wallet.provider,
    ...options.adapter,
  });
  const view = render(
    <AvaKitProvider chains={options.chains ?? [fuji, cChain]} adapters={[adapter]}>
      <AccountProbe />
      <ChainProbe next={cChain} />
    </AvaKitProvider>,
  );
  fireEvent.click(screen.getByText("connect"));
  await waitFor(() => {
    expect(screen.getByTestId("status").textContent).toBe("connected");
  });
  // "connected" is on screen as soon as React commits, but the provider subscribes to
  // the wallet's events in an effect that can run a moment later. An event emitted in
  // between is lost, which made the wallet-event tests fail now and then under load.
  await waitFor(() => {
    expect(wallet.listenerCount()).toBe(3);
  });
  return { adapter, view };
}

// The wallet, not the app, decides which account and network are active. A
// provider announces those changes as EIP-1193 events.
describe("wallet events", () => {
  it("follows an account switch made in the wallet", async () => {
    const wallet = eventedWallet();
    await renderConnected(wallet);
    expect(screen.getByTestId("address").textContent).toBe(TEST_ADDRESS);

    act(() => wallet.emit("accountsChanged", [OTHER_ADDRESS]));

    expect(screen.getByTestId("address").textContent).toBe(OTHER_ADDRESS);
    expect(screen.getByTestId("status").textContent).toBe("connected");
  });

  it("keeps the address when the wallet re-announces the same account in another case", async () => {
    const wallet = eventedWallet();
    await renderConnected(wallet);

    act(() => wallet.emit("accountsChanged", [TEST_ADDRESS.toLowerCase()]));

    expect(screen.getByTestId("address").textContent).toBe(TEST_ADDRESS);
  });

  it("disconnects when the wallet reports no accounts (locked or access revoked)", async () => {
    const wallet = eventedWallet();
    const { adapter } = await renderConnected(wallet);

    act(() => wallet.emit("accountsChanged", []));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(screen.getByTestId("adapter").textContent).toBe("none");
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });

  it("follows the wallet to another chain the app supports", async () => {
    const wallet = eventedWallet();
    await renderConnected(wallet);
    expect(screen.getByTestId("chain").textContent).toBe(fuji.name);

    act(() => wallet.emit("chainChanged", `0x${cChain.id.toString(16)}`));

    expect(screen.getByTestId("chain").textContent).toBe(cChain.name);
    expect(screen.getByTestId("status").textContent).toBe("connected");
    expect(screen.getByTestId("address").textContent).toBe(TEST_ADDRESS);
  });

  it("stays on its chain when the wallet moves to one the app does not support", async () => {
    const wallet = eventedWallet();
    await renderConnected(wallet);

    act(() => wallet.emit("chainChanged", "0x1"));

    expect(screen.getByTestId("chain").textContent).toBe(fuji.name);
    expect(screen.getByTestId("status").textContent).toBe("connected");
  });

  it("disconnects when the wallet ends the session", async () => {
    const wallet = eventedWallet();
    const { adapter } = await renderConnected(wallet);

    act(() => wallet.emit("disconnect", { code: 4900, message: "Disconnected" }));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });

  // MetaMask emits `disconnect` with code 1013 while it is merely reconnecting
  // to its network; the user is still signed in.
  it("keeps the session through a recoverable disconnect while accounts remain", async () => {
    const wallet = eventedWallet();
    const { adapter } = await renderConnected(wallet);

    await act(async () => {
      wallet.emit("disconnect", { code: 1013, message: "Attempting to connect." });
    });

    expect(wallet.provider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(screen.getByTestId("status").textContent).toBe("connected");
    expect(screen.getByTestId("address").textContent).toBe(TEST_ADDRESS);
    expect(adapter.disconnect).not.toHaveBeenCalled();
  });

  it("drops the session on a recoverable disconnect once the accounts are gone", async () => {
    const wallet = eventedWallet();
    await renderConnected(wallet);
    wallet.setAccounts([]);

    await act(async () => {
      wallet.emit("disconnect", { code: 1013, message: "Attempting to connect." });
    });

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
  });

  it("stops listening once disconnected, and when unmounted while connected", async () => {
    const wallet = eventedWallet();
    const { view } = await renderConnected(wallet);
    expect(wallet.listenerCount()).toBe(3);

    fireEvent.click(screen.getByText("disconnect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(wallet.listenerCount()).toBe(0);

    // A late event from the wallet must not resurrect the old account.
    act(() => wallet.emit("accountsChanged", [OTHER_ADDRESS]));
    expect(screen.getByTestId("address").textContent).toBe("none");

    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(wallet.listenerCount()).toBe(3);
    view.unmount();
    expect(wallet.listenerCount()).toBe(0);
  });

  it("tears down once when the adapter's own logout makes the wallet emit disconnect", async () => {
    const wallet = eventedWallet();
    const disconnect = vi.fn(async () => {
      // An embedded wallet's logout announces the end of the session itself.
      wallet.emit("accountsChanged", []);
      wallet.emit("disconnect", { code: 4900, message: "Disconnected" });
    });
    await renderConnected(wallet, { adapter: { disconnect } });

    fireEvent.click(screen.getByText("disconnect"));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("connects wallets whose provider has no event API", async () => {
    const provider = { request: vi.fn(async () => null) } as unknown as EIP1193Provider;
    const adapter = makeMockAdapter({
      connect: vi.fn(async (): Promise<WalletConnection> => ({ address: TEST_ADDRESS, provider })),
      getProvider: () => provider,
    });
    render(
      <AvaKitProvider chains={[fuji]} adapters={[adapter]}>
        <AccountProbe />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("connect"));

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("address").textContent).toBe(TEST_ADDRESS);
  });
});

describe("useBalance", () => {
  it("reads the balance via the mocked core getBalance (no real RPC)", async () => {
    function BalanceProbe({ addr }: { addr: Address }) {
      const { data } = useBalance(addr);
      return <span data-testid="balance">{data === null ? "null" : data.toString()}</span>;
    }

    render(
      <AvaKitProvider chains={[fuji]} adapters={[makeMockAdapter()]}>
        <BalanceProbe addr={TEST_ADDRESS} />
      </AvaKitProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("balance").textContent).toBe("1000");
    });
  });
});

describe("ConnectAvalanche", () => {
  it("renders an enabled option for an available adapter", async () => {
    render(
      <AvaKitProvider chains={[fuji]} adapters={[makeMockAdapter({ name: "Available Wallet" })]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    // Open the wallet picker dialog.
    fireEvent.click(screen.getByText("Connect wallet"));

    const option = await screen.findByRole("button", { name: /Available Wallet/i });
    expect((option as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables an unavailable adapter and shows its reason", async () => {
    const unavailable = makeMockAdapter({
      id: "unavailable",
      name: "Unavailable Wallet",
      isAvailable: () => false,
      unavailableReason: "Missing client ID.",
    });

    render(
      <AvaKitProvider chains={[fuji]} adapters={[unavailable]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("Connect wallet"));

    const option = await screen.findByRole("button", { name: /Unavailable Wallet/i });
    expect((option as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Missing client ID.")).toBeTruthy();
  });

  it("leads with a burner 'Start instantly' option and still offers real wallets", async () => {
    const burner = makeMockAdapter({ id: "burner", name: "Temporary wallet (no setup)" });
    const social = makeMockAdapter({ id: "web3auth", name: "Social login" });

    render(
      <AvaKitProvider chains={[fuji]} adapters={[social, burner]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("Connect wallet"));

    const start = await screen.findByRole("button", { name: /Start instantly/i });
    // The real wallet is still offered as the "already have a wallet?" upgrade.
    expect(screen.getByRole("button", { name: /Social login/i })).toBeTruthy();

    fireEvent.click(start);
    expect(burner.connect).toHaveBeenCalledTimes(1);
  });

  // The account dialog and the wallet picker share one "open" flag, so leaving
  // it set on disconnect made the picker pop up in the account dialog's place.
  it("closes on disconnect instead of reopening as the wallet picker", async () => {
    render(
      <AvaKitProvider chains={[fuji]} adapters={[makeMockAdapter({ name: "Available Wallet" })]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("Connect wallet"));
    fireEvent.click(await screen.findByRole("button", { name: /Available Wallet/i }));
    // Connected: the trigger now shows the shortened address.
    fireEvent.click(await screen.findByRole("button", { name: /0x0000…dEaD/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Disconnect/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Connect wallet/i })).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Connect a wallet")).toBeNull();
  });

  it("closes the account dialog when the wallet itself ends the session", async () => {
    const wallet = eventedWallet();
    const adapter = makeMockAdapter({
      name: "Available Wallet",
      connect: vi.fn(
        async (): Promise<WalletConnection> => ({
          address: TEST_ADDRESS,
          provider: wallet.provider,
        }),
      ),
      getProvider: () => wallet.provider,
    });
    render(
      <AvaKitProvider chains={[fuji]} adapters={[adapter]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );
    fireEvent.click(screen.getByText("Connect wallet"));
    fireEvent.click(await screen.findByRole("button", { name: /Available Wallet/i }));
    fireEvent.click(await screen.findByRole("button", { name: /0x0000…dEaD/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // The provider subscribes in an effect; emit only once it is listening.
    await waitFor(() => {
      expect(wallet.listenerCount()).toBe(3);
    });

    act(() => wallet.emit("accountsChanged", []));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Connect wallet/i })).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the picker open, showing the error, when a connection attempt fails", async () => {
    const failing = makeMockAdapter({
      name: "Failing Wallet",
      connect: vi.fn(async (): Promise<WalletConnection> => {
        throw new Error("User closed the wallet window.");
      }),
    });
    render(
      <AvaKitProvider chains={[fuji]} adapters={[failing]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("Connect wallet"));
    fireEvent.click(await screen.findByRole("button", { name: /Failing Wallet/i }));

    expect(await screen.findByText("User closed the wallet window.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("does not offer the burner on a mainnet, only the real wallets", async () => {
    const burner = makeMockAdapter({ id: "burner", name: "Temporary wallet (no setup)" });
    const social = makeMockAdapter({ id: "web3auth", name: "Social login" });

    render(
      <AvaKitProvider chains={[cChain]} adapters={[social, burner]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("Connect wallet"));

    expect(await screen.findByRole("button", { name: /Social login/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start instantly/i })).toBeNull();
    expect(screen.queryByText(/already have a wallet/i)).toBeNull();
    // With a real wallet available the dialog reads as a plain wallet picker.
    expect(screen.getByText("Connect a wallet")).toBeTruthy();
  });

  it("explains the missing option when the burner is the only adapter on a mainnet", async () => {
    const burner = makeMockAdapter({ id: "burner", name: "Temporary wallet (no setup)" });

    render(
      <AvaKitProvider chains={[cChain]} adapters={[burner]}>
        <ConnectAvalanche />
      </AvaKitProvider>,
    );

    fireEvent.click(screen.getByText("Connect wallet"));

    expect(await screen.findByText(/temporary wallet is testnet-only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start instantly/i })).toBeNull();
  });
});
