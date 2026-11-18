/**
 * Pure helpers for the Interchain view: which two chains a message travels
 * between, and whether its text can be sent at all.
 */

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
