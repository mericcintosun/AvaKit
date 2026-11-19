import type { LockHolder } from "./lock.js";

/**
 * The caller asked for something invalid (a bad name, an over-long message, two
 * identical chains). The HTTP server answers these with 400 and the message;
 * anything else that throws is a 500.
 */
export class InputError extends Error {
  override name = "InputError";
}

/**
 * Refused because another action holds Studio's action lock (see lock.ts). The
 * message is the shared busy message; the HTTP server answers these with 409.
 */
export class BusyError extends Error {
  override name = "BusyError";
  readonly holder: LockHolder | null;
  constructor(message: string, holder: LockHolder | null) {
    super(message);
    this.holder = holder;
  }
}
