import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fuji } from "../chains.js";
import { web3authAdapter } from "./web3auth.js";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";

/** What one instance of the stand-in SDK was asked to do. */
interface SdkRecord {
  options: Record<string, unknown>;
  inits: number;
  connects: number;
  logouts: number;
  /** Chain configs passed to addChain(), in order. */
  added: Array<Record<string, unknown>>;
  /** Chain ids passed to the SDK's own switchChain(), in order. */
  switches: string[];
  /** Methods requested from the EIP-1193 provider the SDK handed out. */
  requests: string[];
}

/**
 * A stand-in for the `@web3auth/modal` SDK. Like the real one, connect() fails
 * until init() has completed. `initOutcomes` scripts what each init() call does,
 * in order, and `switchOutcomes` does the same for the SDK's switchChain(); with
 * nothing scripted, both succeed.
 */
const sdk = vi.hoisted(() => ({
  instances: [] as SdkRecord[],
  initOutcomes: [] as Array<() => Promise<void>>,
  switchOutcomes: [] as Array<() => Promise<void>>,
}));

vi.mock("@web3auth/modal", () => ({
  Web3Auth: class {
    connected = false;
    provider = null;
    private initialised = false;
    private readonly record: SdkRecord;

    constructor(options: Record<string, unknown>) {
      this.record = {
        options,
        inits: 0,
        connects: 0,
        logouts: 0,
        added: [],
        switches: [],
        requests: [],
      };
      sdk.instances.push(this.record);
    }

    async init() {
      this.record.inits += 1;
      await sdk.initOutcomes.shift()?.();
      this.initialised = true;
    }

    async connect() {
      this.record.connects += 1;
      if (!this.initialised) {
        throw new Error("Wallet is not ready yet, Login modal is not initialized");
      }
      this.connected = true;
      return {
        ethereumProvider: {
          request: async ({ method }: { method: string }) => {
            this.record.requests.push(method);
            return method === "eth_accounts" ? [ACCOUNT] : null;
          },
        },
      };
    }

    async logout() {
      this.record.logouts += 1;
      this.connected = false;
    }

    async addChain(config: Record<string, unknown>) {
      this.record.added.push(config);
    }

    async switchChain({ chainId }: { chainId: string }) {
      this.record.switches.push(chainId);
      await sdk.switchOutcomes.shift()?.();
    }
  },
}));

beforeAll(async () => {
  // Resolve the mock once up front, so no test can race its very first import
  // and end up loading the real, browser-only SDK.
  await import("@web3auth/modal");
});

beforeEach(() => {
  sdk.instances.length = 0;
  sdk.initOutcomes.length = 0;
  sdk.switchOutcomes.length = 0;
});

describe("web3authAdapter", () => {
  it("is unavailable with a client-ID hint when no client ID is configured", () => {
    const adapter = web3authAdapter({ clientId: "" });
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.unavailableReason).toContain("NEXT_PUBLIC_WEB3AUTH_CLIENT_ID");
  });

  it("is available with no hint once a client ID is set", () => {
    const adapter = web3authAdapter({ clientId: "test-client-id" });
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.unavailableReason).toBeUndefined();
  });

  it("exposes a stable id and a social-login label", () => {
    const adapter = web3authAdapter({ clientId: "test-client-id" });
    expect(adapter.id).toBe("web3auth");
    expect(adapter.name.toLowerCase()).toContain("social");
  });

  it("initialises the SDK with the client ID and the app's chains, then connects", async () => {
    const adapter = web3authAdapter({ clientId: "test-client-id", chains: [fuji] });

    const connection = await adapter.connect();

    expect(connection.address).toBe(ACCOUNT);
    expect(adapter.getProvider()).toBe(connection.provider);
    expect(sdk.instances).toHaveLength(1);
    expect(sdk.instances[0]?.options).toMatchObject({
      clientId: "test-client-id",
      web3AuthNetwork: "sapphire_devnet",
      defaultChainId: "0xa869",
      chains: [
        {
          chainNamespace: "eip155",
          chainId: "0xa869",
          rpcTarget: fuji.rpcUrl,
          displayName: fuji.name,
          ticker: "AVAX",
        },
      ],
    });
  });

  it("initialises once however often it is used", async () => {
    const adapter = web3authAdapter({ clientId: "test-client-id" });

    await adapter.connect();
    await adapter.switchChain?.(fuji);
    await adapter.connect();

    expect(sdk.instances).toHaveLength(1);
    expect(sdk.instances[0]?.inits).toBe(1);
  });

  // A network blip during init used to leave the un-initialised instance cached:
  // every later connect() reused it and failed until the page was reloaded.
  it("starts over after a failed init instead of reusing the broken instance", async () => {
    sdk.initOutcomes.push(async () => {
      throw new Error("Failed to fetch project configuration");
    });
    const adapter = web3authAdapter({ clientId: "test-client-id" });

    await expect(adapter.connect()).rejects.toThrow("Failed to fetch project configuration");

    const connection = await adapter.connect();

    expect(connection.address).toBe(ACCOUNT);
    expect(sdk.instances).toHaveLength(2);
    expect(sdk.instances.map((instance) => instance.inits)).toEqual([1, 1]);
    // The instance whose init failed was never asked to connect.
    expect(sdk.instances[0]?.connects).toBe(0);
  });

  // The second caller used to get the instance while init() was still running.
  it("makes concurrent callers share one init and wait for it", async () => {
    let finishInit: () => void = () => {};
    sdk.initOutcomes.push(
      () =>
        new Promise<void>((resolve) => {
          finishInit = resolve;
        }),
    );
    const adapter = web3authAdapter({ clientId: "test-client-id" });

    const first = adapter.connect();
    const second = adapter.connect();
    // Let both calls run as far as they can while init is still pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sdk.instances).toHaveLength(1);
    expect(sdk.instances[0]?.inits).toBe(1);
    expect(sdk.instances[0]?.connects).toBe(0);

    finishInit();
    const connections = await Promise.all([first, second]);

    expect(connections.map((connection) => connection.address)).toEqual([ACCOUNT, ACCOUNT]);
    expect(sdk.instances).toHaveLength(1);
    expect(sdk.instances[0]?.inits).toBe(1);
  });

  it("logs out of the initialised SDK on disconnect", async () => {
    const adapter = web3authAdapter({ clientId: "test-client-id" });
    await adapter.connect();

    await adapter.disconnect();

    expect(adapter.getProvider()).toBeNull();
    expect(sdk.instances[0]?.logouts).toBe(1);
  });

  describe("switchChain", () => {
    it("registers the chain with the SDK and switches through it", async () => {
      const adapter = web3authAdapter({ clientId: "test-client-id" });
      const { provider } = await adapter.connect();

      await adapter.switchChain?.(fuji);

      const instance = sdk.instances[0];
      expect(instance?.added).toEqual([
        {
          chainNamespace: "eip155",
          chainId: "0xa869",
          rpcTarget: fuji.rpcUrl,
          displayName: fuji.name,
          blockExplorerUrl: fuji.explorerUrl,
          ticker: "AVAX",
          tickerName: "Avalanche",
        },
      ]);
      expect(instance?.switches).toEqual(["0xa869"]);
      // The SDK switched by itself: the wallet was not asked over EIP-1193.
      expect(instance?.requests).not.toContain("wallet_switchEthereumChain");
      expect(adapter.getProvider()).toBe(provider);
    });

    // Some SDK builds cannot switch to a chain they were not configured with.
    // The adapter then asks the embedded wallet itself, as it would any wallet.
    it("falls back to the wallet's own chain switch when the SDK refuses", async () => {
      sdk.switchOutcomes.push(async () => {
        throw new Error("Chain config not found");
      });
      const adapter = web3authAdapter({ clientId: "test-client-id" });
      await adapter.connect();

      await adapter.switchChain?.(fuji);

      expect(sdk.instances[0]?.switches).toEqual(["0xa869"]);
      expect(sdk.instances[0]?.requests).toContain("wallet_switchEthereumChain");
    });
  });
});
