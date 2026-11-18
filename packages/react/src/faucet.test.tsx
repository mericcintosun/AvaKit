import {
  type AvaChain,
  FaucetError,
  type FaucetResult,
  getBalance,
  type WalletAdapter,
  type WalletConnection,
} from "@avakit/core";
import { cChain, fuji } from "@avakit/core/chains";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, EIP1193Provider } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFaucet } from "./hooks.js";
import { AvaKitProvider, type AvaKitProviderProps, useAvaKit } from "./provider.js";

// The faucet client is the real one from @avakit/core (its typed errors, retry
// and time limit are part of what is tested here); only the network under it is
// replaced: `fetch` is stubbed per test, and the balance read is a mock.
vi.mock("@avakit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avakit/core")>();
  return {
    ...actual,
    getBalance: vi.fn(),
    ensureChain: vi.fn(async () => {}),
  };
});

const FAUCET_URL = "https://faucet.example/fund";
const BURNER = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER = "0x00000000000000000000000000000000000000A1" as Address;
const TX_HASH = `0x${"ab".repeat(32)}` as const;

type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const drip = () => json({ txHash: TX_HASH, amount: "0.02", chainId: fuji.id });
const sendFailed = () =>
  json(
    { error: "The faucet could not send the drip. Try again shortly.", code: "drip_failed" },
    502,
  );
const fundedRecently = () =>
  json(
    { error: "This address was funded recently. Try again later.", code: "address_limited" },
    429,
    {
      "retry-after": "3600",
    },
  );

/** A faucet that answers the requests in order; the last answer repeats. */
function stubFaucet(...answers: Array<() => Response>) {
  let request = 0;
  const spy = vi.fn<Fetch>(async () => {
    const answer = answers[Math.min(request, answers.length - 1)];
    request += 1;
    if (!answer) {
      throw new Error("no answer stubbed");
    }
    return answer();
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** A faucet that holds every request until the test answers it (or the request is aborted). */
function stubPendingFaucet() {
  const waiting: Array<(response: Response) => void> = [];
  const spy = vi.fn<Fetch>(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        waiting.push(resolve);
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", spy);
  return {
    spy,
    answer(response: Response) {
      const resolve = waiting.shift();
      if (!resolve) {
        throw new Error("the faucet has no request waiting");
      }
      resolve(response);
    },
  };
}

/** The JSON body of the `index`-th faucet request. */
function sentBody(spy: ReturnType<typeof stubFaucet>, index = 0): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls[index]?.[1]?.body)) as Record<string, unknown>;
}

/** An EIP-1193 provider with a working event API, so the wallet's side can be played. */
function eventedProvider() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const provider = {
    request: vi.fn(async () => null),
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    provider: provider as unknown as EIP1193Provider,
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(...args);
      }
    },
  };
}

/** A wallet that connects at once as `address`. With id "burner" it is the temporary wallet. */
function wallet(id: string, address: Address = BURNER) {
  const evented = eventedProvider();
  const adapter: WalletAdapter = {
    id,
    name: id,
    isAvailable: () => true,
    connect: async (): Promise<WalletConnection> => ({ address, provider: evented.provider }),
    disconnect: async () => {},
    getProvider: () => evented.provider,
    switchChain: async () => {},
  };
  return { adapter, emit: evented.emit };
}

type ProviderOptions = Partial<Omit<AvaKitProviderProps, "children">>;

/** Render useFaucet() next to the wallet, recording every status it goes through. */
function renderFaucet(options: ProviderOptions = {}) {
  const adapters = options.adapters ?? [wallet("burner").adapter];
  const chains = options.chains ?? [fuji];
  const statuses: string[] = [];
  const view = renderHook(
    () => {
      const kit = useAvaKit();
      const faucet = useFaucet();
      if (statuses[statuses.length - 1] !== faucet.status) {
        statuses.push(faucet.status);
      }
      return { kit, faucet };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AvaKitProvider faucetUrl={FAUCET_URL} {...options} chains={chains} adapters={adapters}>
          {children}
        </AvaKitProvider>
      ),
    },
  );
  return { ...view, statuses };
}

type View = ReturnType<typeof renderFaucet>;

async function connect(view: View, adapterId = "burner") {
  await act(async () => {
    await view.result.current.kit.connect(adapterId);
  });
  expect(view.result.current.kit.status).toBe("connected");
}

async function disconnect(view: View) {
  await act(async () => {
    await view.result.current.kit.disconnect();
  });
  expect(view.result.current.kit.status).toBe("disconnected");
}

/** Give anything that was set in motion the time to happen, so "nothing happened" means it. */
async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  // An empty wallet, unless a test says otherwise.
  vi.mocked(getBalance).mockResolvedValue(0n);
  // No backoff wait between the faucet client's attempts.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(getBalance).mockReset();
});

describe("useFaucet outside the provider", () => {
  it("says what is missing", () => {
    // Silence the React error boundary console noise for this expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useFaucet())).toThrow(/within <AvaKitProvider>/);

    spy.mockRestore();
  });
});

describe("automatic funding of a burner wallet", () => {
  it("funds a burner that connects with an empty balance, and shows it through useFaucet", async () => {
    const faucet = stubPendingFaucet();
    const view = renderFaucet();
    expect(view.result.current.faucet.status).toBe("idle");

    await connect(view);

    // While the faucet has not answered, the app can say so.
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });
    expect(view.result.current.faucet.isFunding).toBe(true);
    expect(view.result.current.faucet.result).toBeNull();

    await act(async () => {
      faucet.answer(drip());
    });

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });
    expect(view.result.current.faucet.result).toEqual({
      txHash: TX_HASH,
      amount: "0.02",
      chainId: fuji.id,
    });
    expect(view.result.current.faucet.error).toBeNull();
    expect(view.result.current.faucet.isFunding).toBe(false);
    // The app could follow it: idle, then funding, then funded.
    expect(view.statuses).toEqual(["idle", "funding", "success"]);

    expect(faucet.spy).toHaveBeenCalledTimes(1);
    expect(faucet.spy.mock.calls[0]?.[0]).toBe(FAUCET_URL);
    expect(sentBody(faucet.spy)).toEqual({ address: BURNER, chainId: fuji.id });
    // The balance was looked at first, on the chain the app is on.
    expect(getBalance).toHaveBeenCalledWith(BURNER, fuji);
  });

  it("retries a failure that may pass, then reports the drip", async () => {
    const faucet = stubFaucet(sendFailed, drip);
    const view = renderFaucet();

    await connect(view);

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });
    expect(faucet).toHaveBeenCalledTimes(2);
    expect(view.result.current.faucet.result?.txHash).toBe(TX_HASH);
    // The failed attempt in between was never shown as an error.
    expect(view.statuses).toEqual(["idle", "funding", "success"]);
  });

  it("shows the faucet's refusal, with its message and code", async () => {
    const faucet = stubPendingFaucet();
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });

    await act(async () => {
      faucet.answer(fundedRecently());
    });

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });
    const { error } = view.result.current.faucet;
    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.message).toBe("This address was funded recently. Try again later.");
    expect(error).toMatchObject({
      code: "rate_limited",
      retryable: false,
      status: 429,
      retryAfterMs: 3_600_000,
      faucetCode: "address_limited",
    });
    expect(view.result.current.faucet.result).toBeNull();
    expect(view.result.current.faucet.isFunding).toBe(false);
    expect(view.statuses).toEqual(["idle", "funding", "error"]);

    // A refusal is not retried, now or later.
    await settle();
    expect(faucet.spy).toHaveBeenCalledTimes(1);
  });

  it("ends in an error after its bounded retries, and then stops", async () => {
    const faucet = stubFaucet(sendFailed);
    const view = renderFaucet();

    await connect(view);

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });
    expect(faucet).toHaveBeenCalledTimes(3);
    expect(view.result.current.faucet.error).toMatchObject({
      code: "unavailable",
      retryable: true,
      message: "The faucet could not send the drip. Try again shortly.",
    });

    // Nothing loops: the state stays an error and the faucet is left alone.
    await settle(60);
    expect(faucet).toHaveBeenCalledTimes(3);
    expect(view.result.current.faucet.status).toBe("error");
  });

  it("lets fund() retry by hand after an error", async () => {
    const faucet = stubFaucet(fundedRecently, drip);
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });

    let funded: FaucetResult | undefined;
    await act(async () => {
      funded = await view.result.current.faucet.fund();
    });

    expect(funded?.txHash).toBe(TX_HASH);
    expect(view.result.current.faucet.status).toBe("success");
    expect(view.result.current.faucet.error).toBeNull();
    expect(view.result.current.faucet.result?.txHash).toBe(TX_HASH);
    expect(faucet).toHaveBeenCalledTimes(2);
    expect(sentBody(faucet, 1)).toEqual({ address: BURNER, chainId: fuji.id });
  });

  // The burner key persists, so reloading the page reconnects the same wallet.
  it("asks for nothing when the wallet already holds funds", async () => {
    vi.mocked(getBalance).mockResolvedValue(20_000_000_000_000_000n);
    const faucet = stubFaucet(fundedRecently);
    const view = renderFaucet();

    await connect(view);
    await settle();

    expect(getBalance).toHaveBeenCalledWith(BURNER, fuji);
    expect(faucet).not.toHaveBeenCalled();
    // No drip was burnt, and no "funded recently" error is on the page.
    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.error).toBeNull();
    expect(view.statuses).toEqual(["idle"]);
  });

  it("asks the faucet anyway when the balance cannot be read", async () => {
    vi.mocked(getBalance).mockRejectedValue(new Error("RPC unreachable"));
    const faucet = stubFaucet(drip);
    const view = renderFaucet();

    await connect(view);

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });
    expect(faucet).toHaveBeenCalledTimes(1);
  });

  // A hanging RPC must not leave a new wallet unfunded for as long as it hangs.
  it("stops waiting for the balance after five seconds and asks the faucet", async () => {
    vi.useFakeTimers();
    vi.mocked(getBalance).mockReturnValue(new Promise<bigint>(() => {}));
    const faucet = stubFaucet(drip);
    const view = renderFaucet();
    await connect(view);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(faucet).not.toHaveBeenCalled();
    expect(view.result.current.faucet.status).toBe("idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(faucet).toHaveBeenCalledTimes(1);
    expect(view.result.current.faucet.status).toBe("success");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when the wallet disconnects during the balance read", async () => {
    vi.useFakeTimers();
    vi.mocked(getBalance).mockReturnValue(new Promise<bigint>(() => {}));
    const faucet = stubFaucet(drip);
    const view = renderFaucet();
    await connect(view);

    await disconnect(view);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(faucet).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(view.result.current.faucet.status).toBe("idle");
  });

  it("funds an address once: reconnecting the same burner does not ask again", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    await disconnect(view);
    await connect(view);
    await settle();

    expect(faucet).toHaveBeenCalledTimes(1);
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it("starts over on the next connection after a failure", async () => {
    const faucet = stubFaucet(fundedRecently, drip);
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });

    await disconnect(view);
    await connect(view);

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });
    expect(faucet).toHaveBeenCalledTimes(2);
  });

  it("funds only the temporary wallet automatically; a real wallet asks", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ adapters: [wallet("injected").adapter] });

    await connect(view, "injected");
    await settle();

    expect(faucet).not.toHaveBeenCalled();
    expect(getBalance).not.toHaveBeenCalled();
    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.enabled).toBe(true);
  });

  it("asks nobody when the app has no faucetUrl", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ faucetUrl: undefined });

    await connect(view);
    await settle();

    // In particular, the hosted AvaKit faucet is never a silent default.
    expect(faucet).not.toHaveBeenCalled();
    expect(getBalance).not.toHaveBeenCalled();
    expect(view.result.current.faucet.enabled).toBe(false);
    await expect(view.result.current.faucet.fund()).rejects.toThrow(/No faucetUrl/);
    expect(faucet).not.toHaveBeenCalled();
  });

  it("stops waiting for a drip when the wallet disconnects, without calling it an error", async () => {
    const faucet = stubPendingFaucet();
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });
    const signal = faucet.spy.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await disconnect(view);
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.error).toBeNull();
    expect(faucet.spy).toHaveBeenCalledTimes(1);
  });

  it("stops waiting for a drip when the app unmounts", async () => {
    const faucet = stubPendingFaucet();
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });
    const signal = faucet.spy.mock.calls[0]?.[1]?.signal;

    view.unmount();
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(faucet.spy).toHaveBeenCalledTimes(1);
  });
});

// A faucet hands out test funds. Nothing here may ask one for a mainnet.
describe("the faucet and mainnet", () => {
  /** Shows what the faucet was asked to fund, by chain id. */
  function requestedChains(spy: ReturnType<typeof stubFaucet>) {
    return spy.mock.calls.map((_call, index) => sentBody(spy, index).chainId);
  }

  it("never asks the faucet for a mainnet when a funded-less burner is moved to one", async () => {
    // A refusal releases the once-per-address guard, so only the mainnet check
    // stands between this burner and a request for chain 43114.
    const faucet = stubFaucet(() => json({ error: "Not today." }, 400));
    const view = renderFaucet({ chains: [fuji, cChain] });
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });
    expect(requestedChains(faucet)).toEqual([fuji.id]);
    vi.mocked(getBalance).mockClear();

    act(() => view.result.current.kit.setChain(cChain));
    await waitFor(() => {
      expect(view.result.current.kit.status).toBe("disconnected");
    });
    await settle();

    expect(requestedChains(faucet)).toEqual([fuji.id]);
    expect(getBalance).not.toHaveBeenCalled();
    expect(view.result.current.kit.chain).toBe(cChain);
  });

  it("is disabled on a mainnet, and fund() refuses without sending anything", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ chains: [cChain], adapters: [wallet("injected").adapter] });
    await connect(view, "injected");

    expect(view.result.current.faucet.enabled).toBe(false);
    await expect(view.result.current.faucet.fund()).rejects.toThrow(
      /only funds testnets, and Avalanche C-Chain is a mainnet/,
    );
    await expect(view.result.current.faucet.fund(OTHER)).rejects.toThrow(/only funds testnets/);

    expect(faucet).not.toHaveBeenCalled();
    expect(view.result.current.faucet.status).toBe("idle");
  });

  it("treats a chain without a testnet flag as a mainnet, and says why", async () => {
    const { testnet: _omitted, ...withoutFlag } = fuji;
    const unflagged = { ...withoutFlag, id: 99_999, name: "Unflagged L1" } as AvaChain;
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ chains: [unflagged], adapters: [wallet("injected").adapter] });
    await connect(view, "injected");

    expect(view.result.current.faucet.enabled).toBe(false);
    await expect(view.result.current.faucet.fund()).rejects.toThrow(
      /^Unflagged L1 has no boolean `testnet` flag/,
    );
    expect(faucet).not.toHaveBeenCalled();
  });

  it("is enabled again once the app is back on a testnet", async () => {
    stubFaucet(drip);
    const view = renderFaucet({ chains: [cChain, fuji], adapters: [wallet("injected").adapter] });
    expect(view.result.current.faucet.enabled).toBe(false);

    act(() => view.result.current.kit.setChain(fuji));

    expect(view.result.current.faucet.enabled).toBe(true);
  });
});

describe("one faucet state for every caller", () => {
  it("shows a manual fund() to another component that only reads the state", async () => {
    stubFaucet(drip);
    const adapters = [wallet("injected").adapter];
    const chains = [fuji];
    const view = renderHook(
      () => ({ kit: useAvaKit(), button: useFaucet(), banner: useFaucet() }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AvaKitProvider chains={chains} adapters={adapters} faucetUrl={FAUCET_URL}>
            {children}
          </AvaKitProvider>
        ),
      },
    );
    await act(async () => {
      await view.result.current.kit.connect();
    });

    await act(async () => {
      await view.result.current.button.fund();
    });

    expect(view.result.current.banner.status).toBe("success");
    expect(view.result.current.banner.result?.txHash).toBe(TX_HASH);
    expect(view.result.current.banner.result).toBe(view.result.current.button.result);
  });

  it("joins the drip already in flight when fund() is called for the same address", async () => {
    const faucet = stubPendingFaucet();
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });

    // The visitor clicks "get test AVAX" while the automatic drip is on its way.
    let manual: Promise<FaucetResult> = Promise.resolve({});
    act(() => {
      manual = view.result.current.faucet.fund();
    });
    await settle();
    expect(faucet.spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      faucet.answer(drip());
      await manual;
    });

    await expect(manual).resolves.toMatchObject({ txHash: TX_HASH });
    expect(view.result.current.faucet.status).toBe("success");
    // One request, so no "funded recently" refusal of a second one.
    expect(faucet.spy).toHaveBeenCalledTimes(1);
    expect(view.statuses).toEqual(["idle", "funding", "success"]);
  });

  // The other order: the visitor clicks while the automatic drip is still
  // reading the balance. The drip then finds a request under way and joins it.
  it("lets the automatic drip join a fund() that started during its balance read", async () => {
    let answerBalance: (balance: bigint) => void = () => {};
    vi.mocked(getBalance).mockReturnValue(
      new Promise<bigint>((resolve) => {
        answerBalance = resolve;
      }),
    );
    const faucet = stubPendingFaucet();
    const view = renderFaucet();
    await connect(view);
    expect(faucet.spy).not.toHaveBeenCalled();

    let manual: Promise<FaucetResult> = Promise.resolve({});
    act(() => {
      manual = view.result.current.faucet.fund();
    });
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });
    expect(faucet.spy).toHaveBeenCalledTimes(1);

    // The balance read comes back empty: without the request under way, this
    // would be the moment the automatic drip sends its own.
    await act(async () => {
      answerBalance(0n);
    });
    await settle();
    expect(faucet.spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      faucet.answer(drip());
      await manual;
    });
    expect(view.result.current.faucet.status).toBe("success");
    expect(faucet.spy).toHaveBeenCalledTimes(1);
  });

  it("sends a separate request for another address", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    await act(async () => {
      await view.result.current.faucet.fund(OTHER);
    });

    expect(faucet).toHaveBeenCalledTimes(2);
    expect(sentBody(faucet, 1)).toEqual({ address: OTHER, chainId: fuji.id });
  });

  it("goes back to idle on reset()", async () => {
    stubFaucet(fundedRecently);
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });

    act(() => view.result.current.faucet.reset());

    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.error).toBeNull();
    expect(view.result.current.faucet.result).toBeNull();
  });

  it("does not let a request that was reset away report afterwards", async () => {
    const faucet = stubPendingFaucet();
    const view = renderFaucet({ adapters: [wallet("injected").adapter] });
    await connect(view, "injected");
    let manual: Promise<FaucetResult> = Promise.resolve({});
    act(() => {
      manual = view.result.current.faucet.fund();
    });
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });

    act(() => view.result.current.faucet.reset());
    await act(async () => {
      faucet.answer(drip());
      await manual;
    });

    // The caller still gets its answer; the dismissed state stays dismissed.
    await expect(manual).resolves.toMatchObject({ txHash: TX_HASH });
    expect(view.result.current.faucet.status).toBe("idle");
  });

  // After a reset() the first request no longer reports. A fund() that joins it
  // then has to report it, or the app sees nothing while it is funded (or refused).
  describe("a fund() that joins a request dismissed by reset()", () => {
    async function fundResetFund(view: View) {
      let first: Promise<FaucetResult> = Promise.resolve({});
      act(() => {
        first = view.result.current.faucet.fund();
      });
      await waitFor(() => {
        expect(view.result.current.faucet.status).toBe("funding");
      });
      act(() => view.result.current.faucet.reset());
      expect(view.result.current.faucet.status).toBe("idle");

      let second: Promise<FaucetResult> = Promise.resolve({});
      act(() => {
        second = view.result.current.faucet.fund();
      });
      // Neither caller is left with an unhandled rejection while the test looks on.
      first.catch(() => {});
      second.catch(() => {});
      return { first, second };
    }

    it("reports funding at once and then the drip", async () => {
      const faucet = stubPendingFaucet();
      const view = renderFaucet({ adapters: [wallet("injected").adapter] });
      await connect(view, "injected");

      const { first, second } = await fundResetFund(view);
      expect(view.result.current.faucet.status).toBe("funding");
      await settle();
      expect(faucet.spy).toHaveBeenCalledTimes(1);

      await act(async () => {
        faucet.answer(drip());
        await second;
      });

      await expect(second).resolves.toMatchObject({ txHash: TX_HASH });
      await expect(first).resolves.toMatchObject({ txHash: TX_HASH });
      expect(view.result.current.faucet.status).toBe("success");
      expect(view.result.current.faucet.result?.txHash).toBe(TX_HASH);
      expect(view.statuses).toEqual(["idle", "funding", "idle", "funding", "success"]);
      expect(faucet.spy).toHaveBeenCalledTimes(1);
    });

    it("reports the faucet's refusal", async () => {
      const faucet = stubPendingFaucet();
      const view = renderFaucet({ adapters: [wallet("injected").adapter] });
      await connect(view, "injected");

      const { second } = await fundResetFund(view);
      await act(async () => {
        faucet.answer(fundedRecently());
        await second.catch(() => {});
      });

      await expect(second).rejects.toBeInstanceOf(FaucetError);
      expect(view.result.current.faucet.status).toBe("error");
      expect(view.result.current.faucet.error?.message).toBe(
        "This address was funded recently. Try again later.",
      );
      expect(view.statuses).toEqual(["idle", "funding", "idle", "funding", "error"]);
      expect(faucet.spy).toHaveBeenCalledTimes(1);
    });
  });

  // The automatic drip sends its request with an abort signal. When it is
  // aborted, the fund() that joined it reports, and has to see that it was
  // aborted rather than refused.
  it("leaves the state idle when a request a fund() joined is aborted", async () => {
    // Empty for the first look, funded afterwards, so that the drip starting
    // over finds nothing to do.
    vi.mocked(getBalance).mockResolvedValue(5n);
    vi.mocked(getBalance).mockResolvedValueOnce(0n);
    const faucet = stubPendingFaucet();
    let faucetUrl = FAUCET_URL;
    const adapters = [wallet("burner").adapter];
    const chains = [fuji];
    const view = renderHook(() => ({ kit: useAvaKit(), faucet: useFaucet() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AvaKitProvider faucetUrl={faucetUrl} chains={chains} adapters={adapters}>
          {children}
        </AvaKitProvider>
      ),
    });
    await act(async () => {
      await view.result.current.kit.connect("burner");
    });
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("funding");
    });
    const signal = faucet.spy.mock.calls[0]?.[1]?.signal;

    act(() => view.result.current.faucet.reset());
    let manual: Promise<FaucetResult> = Promise.resolve({});
    act(() => {
      manual = view.result.current.faucet.fund();
    });
    manual.catch(() => {});
    expect(view.result.current.faucet.status).toBe("funding");

    // The app moves to another faucet: the automatic drip's effect is cleaned
    // up and aborts its request, on the same wallet and chain.
    faucetUrl = "https://faucet.example/other";
    view.rerender();
    await settle();

    expect(signal?.aborted).toBe(true);
    await expect(manual).rejects.toThrow();
    expect(view.result.current.kit.status).toBe("connected");
    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.error).toBeNull();
    expect(faucet.spy).toHaveBeenCalledTimes(1);
  });

  // "Funded" is a statement about one wallet. It must not carry over to the next.
  it("reads idle again once the wallet disconnects", async () => {
    stubFaucet(drip);
    const view = renderFaucet();
    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    await disconnect(view);

    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.result).toBeNull();
  });

  it("reads idle again when the wallet switches to another account", async () => {
    stubFaucet(drip);
    const injected = wallet("injected");
    const view = renderFaucet({ adapters: [injected.adapter] });
    await connect(view, "injected");
    await act(async () => {
      await view.result.current.faucet.fund();
    });
    expect(view.result.current.faucet.status).toBe("success");

    act(() => injected.emit("accountsChanged", [OTHER]));

    expect(view.result.current.kit.address).toBe(OTHER);
    expect(view.result.current.faucet.status).toBe("idle");
    expect(view.result.current.faucet.result).toBeNull();
  });

  it("funds an address passed to fund() with no wallet connected, and shows it", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ adapters: [] });

    await act(async () => {
      await view.result.current.faucet.fund(OTHER);
    });

    expect(sentBody(faucet)).toEqual({ address: OTHER, chainId: fuji.id });
    expect(view.result.current.faucet.status).toBe("success");
    expect(view.result.current.faucet.result?.txHash).toBe(TX_HASH);
  });

  it("refuses to fund without an address, as before", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ adapters: [] });

    await expect(view.result.current.faucet.fund()).rejects.toThrow(
      /Connect a wallet \(or pass an address\)/,
    );
    expect(faucet).not.toHaveBeenCalled();
    expect(view.result.current.faucet.status).toBe("idle");
  });
});

describe("faucetToken", () => {
  it("sends no token when the app gives no faucetToken", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet();

    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    expect("turnstileToken" in sentBody(faucet)).toBe(false);
  });

  it("asks for a token before the automatic drip and sends it", async () => {
    const faucet = stubFaucet(drip);
    const faucetToken = vi.fn(async () => "tok-auto");
    const view = renderFaucet({ faucetToken });

    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    expect(faucetToken).toHaveBeenCalledTimes(1);
    expect(sentBody(faucet)).toEqual({
      address: BURNER,
      chainId: fuji.id,
      turnstileToken: "tok-auto",
    });
  });

  it("asks for a token before a manual fund() and sends it", async () => {
    const faucet = stubFaucet(drip);
    const faucetToken = vi.fn(async () => "tok-manual");
    const view = renderFaucet({ faucetToken, adapters: [wallet("injected").adapter] });
    await connect(view, "injected");
    expect(faucetToken).not.toHaveBeenCalled();

    await act(async () => {
      await view.result.current.faucet.fund();
    });

    expect(faucetToken).toHaveBeenCalledTimes(1);
    expect(sentBody(faucet).turnstileToken).toBe("tok-manual");
  });

  // A token can be used once, so every attempt needs its own.
  it("asks for a fresh token before every attempt", async () => {
    const faucet = stubFaucet(sendFailed, sendFailed, drip);
    let issued = 0;
    const faucetToken = vi.fn(async () => {
      issued += 1;
      return `tok-${issued}`;
    });
    const view = renderFaucet({ faucetToken });

    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    expect(faucetToken).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((i) => sentBody(faucet, i).turnstileToken)).toEqual([
      "tok-1",
      "tok-2",
      "tok-3",
    ]);
  });

  it("leaves the token out when the callback has none", async () => {
    const faucet = stubFaucet(drip);
    const view = renderFaucet({ faucetToken: async () => undefined });

    await connect(view);
    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("success");
    });

    expect("turnstileToken" in sentBody(faucet)).toBe(false);
  });

  it("uses the callback from the latest render", async () => {
    const faucet = stubFaucet(drip);
    const adapters = [wallet("injected").adapter];
    const chains = [fuji];
    let widgetToken = "tok-first";
    const view = renderHook(() => ({ kit: useAvaKit(), faucet: useFaucet() }), {
      wrapper: ({ children }: { children: ReactNode }) => {
        // Captured per render, so a callback kept from an earlier render would
        // still hand out the earlier token.
        const token = widgetToken;
        return (
          <AvaKitProvider
            chains={chains}
            adapters={adapters}
            faucetUrl={FAUCET_URL}
            // An inline function, new on every render, as apps write it.
            faucetToken={async () => token}
          >
            {children}
          </AvaKitProvider>
        );
      },
    });
    await act(async () => {
      await view.result.current.kit.connect();
    });
    const fund = view.result.current.faucet.fund;

    widgetToken = "tok-second";
    view.rerender();
    await act(async () => {
      await view.result.current.faucet.fund();
    });

    expect(sentBody(faucet).turnstileToken).toBe("tok-second");
    // A new callback does not change fund()'s identity.
    expect(view.result.current.faucet.fund).toBe(fund);
  });

  it("does not ask for a token when no request is made", async () => {
    vi.mocked(getBalance).mockResolvedValue(1n);
    stubFaucet(drip);
    const faucetToken = vi.fn(async () => "tok-unused");
    const view = renderFaucet({ faucetToken });

    await connect(view);
    await settle();

    expect(faucetToken).not.toHaveBeenCalled();
  });

  it("reports a callback that fails, and sends nothing", async () => {
    const faucet = stubFaucet(drip);
    const failure = new Error("The captcha was dismissed.");
    const view = renderFaucet({
      faucetToken: async () => {
        throw failure;
      },
    });

    await connect(view);

    await waitFor(() => {
      expect(view.result.current.faucet.status).toBe("error");
    });
    expect(view.result.current.faucet.error).toBe(failure);
    expect(faucet).not.toHaveBeenCalled();
  });
});
