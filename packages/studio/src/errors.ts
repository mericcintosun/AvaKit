/**
 * The caller asked for something invalid (a bad name, an over-long message, two
 * identical chains). The HTTP server answers these with 400 and the message;
 * anything else that throws is a 500.
 */
export class InputError extends Error {
  override name = "InputError";
}
