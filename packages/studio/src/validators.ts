/**
 * The rules for the few request-derived values that can reach an avalanche-cli
 * argument: an L1's name, chain ID and token symbol, and a transfer amount.
 *
 * Strict and whitelist-only. Even though every command is spawned from an
 * argument ARRAY (never a shell), a value that passes can never be read as a
 * flag or a path. The server and the MCP face refuse anything that fails them.
 *
 * This module imports nothing, on purpose: the dashboard uses the very same
 * functions to say so BEFORE a click (ui/src/lib/validators.ts), so the page
 * and the server can never disagree about what is valid.
 */

export function isValidL1Name(v: string): boolean {
  return /^[a-z][a-z0-9]{1,31}$/.test(v);
}

export function isValidToken(v: string): boolean {
  return /^[A-Z][A-Z0-9]{0,7}$/.test(v);
}

export function isValidChainId(v: string): boolean {
  if (!/^[1-9][0-9]{0,9}$/.test(v)) return false;
  const n = Number(v);
  return n >= 1 && n <= 4294967295;
}

/** A positive decimal amount string, e.g. "0.3". */
export function isValidAmount(v: string): boolean {
  return /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(v) && Number(v) > 0 && Number(v) <= 1000;
}
