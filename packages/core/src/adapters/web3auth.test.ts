import { describe, expect, it } from "vitest";
import { web3authAdapter } from "./web3auth.js";

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
});
