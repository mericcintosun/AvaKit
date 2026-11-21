import type { LockHolder } from "./lock.js";

/**
 * The caller asked for something invalid (a bad name, an over-long message, two
 * identical chains). The HTTP server answers these with 400 and the message;
 * anything else that throws is a 500.
 */
export class InputError extends Error {
  override name = "InputError";
}

/** The refusal of anything new once Studio has begun to stop (shutdown.ts). */
export const STOPPING_MESSAGE = "Studio is stopping: no new action can start.";

/**
 * Refused because another action holds Studio's action lock (see lock.ts), or
 * because Studio is stopping (STOPPING_MESSAGE, with no holder). The HTTP
 * server answers these with 409.
 */
export class BusyError extends Error {
  override name = "BusyError";
  readonly holder: LockHolder | null;
  constructor(message: string, holder: LockHolder | null) {
    super(message);
    this.holder = holder;
  }
}
