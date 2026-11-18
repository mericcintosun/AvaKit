/**
 * Pure helpers for the Interchain view: which two chains a message travels
 * between, and whether its text can be sent at all — and for what the Overview
 * card and the Devnet banner say about Interchain Messaging.
 */

/**
 * How far Interchain Messaging is, as far as the dashboard knows:
 *  - "no-peers": fewer than two running L1s with Interchain Messaging;
 *  - "checking": two or more, but the messengers have not been looked at yet;
 *  - "needs-messengers": two or more, but no two of them have linked messengers;
 *  - "ready": a message can be sent right now.
 * Two running L1s are NOT "ready": the send is refused until the messengers
 * are deployed, so nothing may say otherwise.
 */
export type InterchainStage = "no-peers" | "checking" | "needs-messengers" | "ready";

/** The L1s that can take part in Interchain Messaging: running, with Teleporter. */
export function countPeers(l1s: { running: boolean; teleporterReady: boolean }[]): number {
  return l1s.filter((l) => l.running && l.teleporterReady).length;
}

/**
 * `peers` comes from the devnet status; `icm` is the server's Interchain state
 * (null until it has been fetched), whose `ready` knows about the messengers.
 */
export function interchainStage(peers: number, icm: { ready: boolean } | null): InterchainStage {
  if (peers < 2) return "no-peers";
  if (!icm) return "checking";
  return icm.ready ? "ready" : "needs-messengers";
}

/** The Overview's Interchain card. Only "ready" is shown as live. */
export function interchainCard(stage: InterchainStage): {
  value: string;
  live: boolean;
  sub: string;
} {
  switch (stage) {
    case "ready":
      return { value: "Ready", live: true, sub: "send a cross-chain message" };
    case "needs-messengers":
      return { value: "Set up", live: false, sub: "deploy the messengers to send a message" };
    case "checking":
      return { value: "…", live: false, sub: "checking the messengers" };
    case "no-peers":
      return { value: "—", live: false, sub: "needs 2 running L1s" };
  }
}

/**
 * The Devnet view's "your devnet is live" banner: what it says about sending a
 * message, and what its button (which opens the Interchain view) is called.
 * Null when there are not two L1s to send between.
 */
export function devnetBanner(
  stage: InterchainStage,
  peers: number,
): { detail: string; action: string } | null {
  const l1s = `${peers === 2 ? "Two" : peers} L1s with a relayer`;
  switch (stage) {
    case "ready":
      return { detail: `${l1s} — ready for a cross-chain message.`, action: "Send a message" };
    case "needs-messengers":
      return {
        detail: `${l1s} — deploy the messengers to send a message.`,
        action: "Deploy messengers",
      };
    case "checking":
      return { detail: `${l1s}.`, action: "Open Interchain" };
    case "no-peers":
      return null;
  }
}

export interface Pair {
  from: string;
  to: string;
}

/**
 * The source and destination to use, given the chains that exist right now and
 * what the user last picked. A pick that is still valid is kept; one that is
 * gone (the chain stopped) or would send a chain to itself falls back to the
 * first other chain. Null when there are not two chains to choose from.
 */
export function resolvePair(names: string[], picked: Partial<Pair> = {}): Pair | null {
  if (names.length < 2) return null;
  const from = picked.from && names.includes(picked.from) ? picked.from : (names[0] as string);
  const to =
    picked.to && picked.to !== from && names.includes(picked.to)
      ? picked.to
      : (names.find((n) => n !== from) as string);
  return { from, to };
}

/** Choose a new source. Picking the current destination swaps the two. */
export function withFrom(pair: Pair, from: string): Pair {
  return { from, to: from === pair.to ? pair.from : pair.to };
}

/** Choose a new destination. Picking the current source swaps the two. */
export function withTo(pair: Pair, to: string): Pair {
  return { from: to === pair.from ? pair.to : pair.from, to };
}

/** The size a message has on the wire: UTF-8 bytes, not characters. */
export function messageBytes(message: string): number {
  return new TextEncoder().encode(message).length;
}

/**
 * Why `message` can't be sent, or null when it can. The server applies the same
 * rules (and is the one that enforces them); checking here just says so before
 * the click instead of after it.
 */
export function messageProblem(message: string, maxBytes: number): string | null {
  if (message.length === 0) return "Type a message to send.";
  const bytes = messageBytes(message);
  if (bytes > maxBytes) {
    return `Too long: ${bytes} of ${maxBytes} bytes. The messenger contract rejects anything longer.`;
  }
  if (message.startsWith("-")) return "A message can't start with “-”.";
  return null;
}

/**
 * A delivery on a local devnet takes a few seconds. A message that is still not
 * there after this long is no longer called "in flight": the send only put it
 * on the source chain, and whether it arrives is up to the relayer and the
 * destination messenger.
 */
export const DELIVERY_TIMEOUT_MS = 30_000;

/** Milliseconds until a message sent at `sentAt` is overdue — 0 once it is. */
export function overdueIn(sentAt: number, now: number, timeoutMs = DELIVERY_TIMEOUT_MS): number {
  return Math.max(0, sentAt + timeoutMs - now);
}

/**
 * Whether the message this view sent has arrived. The destination's delivery
 * count going past what it was just before the send is the proof; comparing the
 * text alone would call a message "delivered" the moment it is sent whenever
 * the same text was sent before.
 */
export function hasArrived(
  sent: { message: string; receivedBefore: number | null },
  destination: { lastMessage: string | null; messagesReceived: number | null },
): boolean {
  if (destination.lastMessage !== sent.message) return false;
  if (sent.receivedBefore === null || destination.messagesReceived === null) return true;
  return destination.messagesReceived > sent.receivedBefore;
}
