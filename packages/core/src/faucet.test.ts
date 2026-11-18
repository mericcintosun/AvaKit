import { afterEach, describe, expect, it, vi } from "vitest";
import { FaucetError } from "./errors.js";
import { requestFaucet } from "./faucet.js";

const FAUCET = "https://faucet.example/drip";
const ADDRESS = "0x000000000000000000000000000000000000dEaD";

function stubFetch(respond: () => Response | Promise<Response>) {
  const spy = vi.fn(
    (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(respond()),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestFaucet", () => {
  it("posts the address and chain id and returns what the faucet reports", async () => {
    const spy = stubFetch(() => json({ txHash: "0xabc", amount: "0.5" }));

    const result = await requestFaucet({ url: FAUCET, address: ADDRESS, chainId: 43113 });

    expect(result).toEqual({ txHash: "0xabc", amount: "0.5" });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe(FAUCET);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ address: ADDRESS, chainId: 43113 });
  });

  it("reports a refusal with the faucet's own message and the HTTP status", async () => {
    stubFetch(() => json({ error: "This address was funded less than 24 hours ago." }, 429));

    const request = requestFaucet({ url: FAUCET, address: ADDRESS });

    await expect(request).rejects.toBeInstanceOf(FaucetError);
    await expect(request).rejects.toThrow("funded less than 24 hours ago");
    await expect(request).rejects.toHaveProperty("status", 429);
  });

  it("still reports the status when a refusal carries no JSON body", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));

    const request = requestFaucet({ url: FAUCET, address: ADDRESS });

    await expect(request).rejects.toBeInstanceOf(FaucetError);
    await expect(request).rejects.toThrow("HTTP 502");
    await expect(request).rejects.toHaveProperty("status", 502);
  });

  it("turns a network failure into a FaucetError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const request = requestFaucet({ url: FAUCET, address: ADDRESS });

    await expect(request).rejects.toBeInstanceOf(FaucetError);
    await expect(request).rejects.toThrow("Failed to fetch");
  });
});
