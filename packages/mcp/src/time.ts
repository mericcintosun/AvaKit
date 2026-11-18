/**
 * The clock the waits in this package run on: polling for a receipt, for funds
 * to arrive, backing off before a faucet retry. Kept behind one object so a test
 * can replace it and run a thirty-second wait without waiting thirty seconds.
 */
export const clock = {
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};
