import { describe, expect, it } from "vitest";
import { connectionAfterFailure, connectionLabel } from "./connection";

/** What api() throws when the server answers with an error status. */
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("connection state from a poll's outcome", () => {
  it("is offline when the server did not answer at all", () => {
    // What fetch() throws once Studio has been stopped.
    expect(connectionAfterFailure(new TypeError("Failed to fetch"))).toBe("offline");
    expect(connectionAfterFailure(new Error("network changed"))).toBe("offline");
    expect(connectionAfterFailure(undefined)).toBe("offline");
    expect(connectionAfterFailure("boom")).toBe("offline");
  });

  it("is a stale token when the server no longer knows this tab's session", () => {
    // Studio was restarted: a new token, and this page still holds the old one.
    expect(connectionAfterFailure(apiError(401))).toBe("stale-token");
  });

  it("stays online when the server answered with any other error", () => {
    // It is there; one request going wrong is not a lost connection.
    expect(connectionAfterFailure(apiError(500))).toBe("online");
    expect(connectionAfterFailure(apiError(404))).toBe("online");
  });

  it("labels the header badge", () => {
    expect(connectionLabel("connecting")).toBe("connecting");
    expect(connectionLabel("online")).toBe("connected");
    // Neither a stopped Studio nor a restarted one is "connected".
    expect(connectionLabel("offline")).toBe("offline");
    expect(connectionLabel("stale-token")).toBe("offline");
  });
});
