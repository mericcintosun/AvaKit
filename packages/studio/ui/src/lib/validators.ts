/**
 * The server's own rules for an L1's name, chain ID and token symbol and for a
 * transfer amount — the same functions, not a copy of their regular
 * expressions. The server is still the one that enforces them; the dashboard
 * uses them to say so before a click instead of after it, and the two can never
 * drift apart.
 */
export {
  isValidAmount,
  isValidChainId,
  isValidL1Name,
  isValidToken,
} from "../../../src/validators";
