import type { WalletAdapter, WalletConnection } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
