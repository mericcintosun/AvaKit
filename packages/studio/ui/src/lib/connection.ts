/**
 * Whether this tab can still talk to the Studio server, decided afresh by
 * EVERY status poll. It used to be decided once, when the page loaded: a tab
 * left open kept saying "connected" (and "Your devnet is live") long after
 * Studio had been stopped or restarted.
 */

export type Connection =
  /** No poll has come back yet. */
  | "connecting"
  | "online"
  /** Studio did not answer: it was stopped, or it is not reachable. */
  | "offline"
  /** Studio answered, but not to this tab's session token: it was restarted. */
  | "stale-token";

/**
 * What a failed poll says about the connection. `error` is whatever the
 * request threw: an API error carries the HTTP `status` the server answered
 * with; a request that got no answer at all (the server is gone) does not.
 */
export function connectionAfterFailure(error: unknown): Connection {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status: unknown }).status
      : null;
  if (status === 401) return "stale-token";
  // Any other answer is still an answer: the server is there (and said why).
  return typeof status === "number" ? "online" : "offline";
}

/** The header badge's word for a connection state. */
export function connectionLabel(connection: Connection): "connecting" | "connected" | "offline" {
  if (connection === "connecting") return "connecting";
  return connection === "online" ? "connected" : "offline";
}
