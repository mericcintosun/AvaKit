"use client";

/**
 * Can the connected wallet pay for gas — and if it cannot, how does it get funds?
 *
 * A new wallet holds nothing, and a transaction sent from an empty wallet can
 * only fail. `useFunding()` watches the wallet's balance and this app's faucet
 * (the `faucetUrl` chosen in app/providers.tsx), and `<FundingNotice />` says
 * what is going on, next to the button it explains:
 *
 * - `<AvaKitProvider>` asks the faucet by itself when the temporary wallet
 *   ("Start instantly") connects with an empty balance, and reports that
 *   request through `useFaucet()`. Nothing here asks a second time: the faucet
 *   would refuse it. Any other empty wallet gets a button.
 * - While the faucet is working: one quiet line. Once the wallet holds funds:
 *   nothing but a link to the official faucet, for later.
 * - When the faucet refuses (it is rate-limited, and it can be empty): its own
 *   message, a "Try again" button, and the official faucet as the way forward.
 *
 * Disable a button that sends a transaction while `isEmpty` is true, and only
 * then: a balance that has not been read yet is unknown, not empty.
 */

import { Button, useAvaKit, useBalance, useFaucet } from "@avakit/react";
import { useCallback, useEffect, useState } from "react";

/** How often the balance is read again while the wallet is still empty. */
const BALANCE_POLL_MS = 3_000;
/** A faucet drip lands within seconds. Past this, stop implying it is on its way. */
const DRIP_ARRIVAL_MS = 30_000;
/**
 * How long the provider gets to start its own request for a temporary wallet.
 * It reads the balance first (for at most five seconds), so for a moment the
 * wallet is empty and nothing has been asked yet.
 */
const AUTO_FUNDING_GRACE_MS = 8_000;
/** Adapter id of the temporary in-browser wallet (`burnerAdapter()` in @avakit/core). */
const TEMPORARY_WALLET_ID = "burner";

export type FundingState =
  /** The balance has not been read yet, or could not be. */
  | "unknown"
  /** The wallet holds some of the chain's native token. */
  | "funded"
  /** The faucet has been asked, or what it sent is on its way. */
  | "requesting"
  /** The faucet refused, or did not answer. */
  | "refused"
  /** The faucet sent funds that have not arrived. */
  | "delayed"
  /** The wallet is empty and nothing is on its way. */
  | "empty";

export interface Funding {
  /** The wallet's native balance in wei; null until it has been read. */
  balance: bigint | null;
  /** Why the balance could not be read, when it could not. */
  balanceError: Error | null;
  /** True only when the balance was read and is zero: nothing can be sent. */
  isEmpty: boolean;
  /** Where the wallet stands; `<FundingNotice />` renders it. */
  state: FundingState;
  /** What the faucet said when it refused. */
  faucetError: string | null;
  /** Whether this app has a faucet to ask (see app/providers.tsx). */
  canRequest: boolean;
  /** Ask the faucet to fund the connected wallet. */
  request: () => void;
  /** Read the balance again, for example after sending a transaction. */
  refresh: () => void;
}

export function useFunding(): Funding {
  const { address, activeAdapterId } = useAvaKit();
  const { data: balance, error: balanceError, refetch } = useBalance();
  const faucet = useFaucet();

  const funded = balance !== null && balance > 0n;

  // Until the wallet holds something, keep looking: funds can come from this
  // app's faucet, from the official one in another tab, or from another wallet.
  useEffect(() => {
    if (!address || funded) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, BALANCE_POLL_MS);
    return () => clearInterval(timer);
  }, [address, funded, refetch]);

  // What the faucet was last asked for this wallet on this chain, whoever
  // asked: the provider by itself, or the button below. ("idle" again as soon
  // as another wallet connects.)
  const status = faucet.status;

  // <AvaKitProvider> asks the faucet by itself when the temporary wallet
  // connects, after reading its balance. Until it has had time to, an empty
  // temporary wallet is one whose funds are being fetched, not one to offer a
  // button for.
  const autoFunded = activeAdapterId === TEMPORARY_WALLET_ID && faucet.enabled;
  const [graceOverFor, setGraceOverFor] = useState<string | null>(null);
  useEffect(() => {
    if (!address || !autoFunded) return;
    const timer = setTimeout(() => setGraceOverFor(address), AUTO_FUNDING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [address, autoFunded]);
  const awaitingAutoFunding = autoFunded && graceOverFor !== address;

  // "success" means the faucet broadcast its transaction, not that it was
  // mined, and a broadcast transaction can still be dropped. Keep reading the
  // balance (above), give the drip time to arrive, then stop saying it is on
  // its way.
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!address || status !== "success" || funded) return;
    const timer = setTimeout(() => setDelayed(true), DRIP_ARRIVAL_MS);
    return () => {
      clearTimeout(timer);
      setDelayed(false);
    };
  }, [address, status, funded]);

  // A wallet that holds funds needs nothing, whatever the faucet said: asked
  // for a wallet that already has a balance, it refuses ("funded recently"),
  // and that is not worth a word.
  let state: FundingState;
  if (funded) state = "funded";
  else if (status === "funding") state = "requesting";
  else if (balance === null) state = "unknown";
  else if (status === "error") state = "refused";
  else if (status === "success") state = delayed ? "delayed" : "requesting";
  else if (awaitingAutoFunding) state = "requesting";
  else state = "empty";

  const fund = faucet.fund;
  const request = useCallback(() => {
    // A refusal comes back through useFaucet().error, which the notice shows;
    // the rejected promise carries the same error and needs no second handler.
    fund().catch(() => {});
  }, [fund]);
  const refresh = useCallback(() => void refetch(), [refetch]);

  return {
    balance,
    balanceError,
    isEmpty: balance === 0n,
    state,
    faucetError: status === "error" ? describeRefusal(faucet.error) : null,
    canRequest: faucet.enabled,
    request,
    refresh,
  };
}

/**
 * The faucet's own words, short enough to show as they are, and how long it
 * asked to wait when it said so (the `retryAfterMs` of a `FaucetError` from
 * @avakit/core, which a rate-limited faucet sets).
 */
function describeRefusal(error: Error | null): string {
  const message = error?.message || "The faucet did not answer.";
  const line = (message.split("\n")[0] ?? message).slice(0, 200);
  const wait = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  if (typeof wait !== "number" || !Number.isFinite(wait) || wait <= 0) return line;
  return `${line} The faucet asks for a wait of about ${describeWait(wait)}.`;
}

/** "5 seconds", "40 minutes", "23 hours": a wait in the largest unit that fits. */
function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const [count, unit] =
    seconds < 90
      ? [seconds, "second"]
      : seconds < 90 * 60
        ? [Math.round(seconds / 60), "minute"]
        : [Math.round(seconds / 3600), "hour"];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * What the wallet needs before it can send a transaction, and what is being
 * done about it. Place it right under the button it explains.
 */
export function FundingNotice({ funding }: { funding: Funding }) {
  const { address, chain } = useAvaKit();
  if (!address || funding.state === "unknown") return null;

  // "test AVAX" on a testnet; plain "AVAX" where it is real money.
  const coin = `${chain.testnet ? "test " : ""}${chain.nativeCurrency.symbol}`;
  // The chain's public faucet (a page for people), when it has one. Fuji's is
  // on Builder Hub and asks for a free sign-in, which is said wherever it is
  // linked; reword that if you move this app to a chain with another faucet.
  const officialFaucet = chain.faucetUrl ? (
    <a
      href={chain.faucetUrl}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-4"
    >
      official faucet
    </a>
  ) : null;

  if (funding.state === "funded") {
    return officialFaucet ? (
      <p className="text-muted-foreground text-center text-xs">
        Need more {coin}? Use the {officialFaucet} (needs a free Builder Hub sign-in).
      </p>
    ) : null;
  }

  if (funding.state === "requesting") {
    return (
      <p role="status" className="text-muted-foreground text-center text-xs">
        Getting {coin}…
      </p>
    );
  }

  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-xs">
      <p>
        This wallet has no {coin} yet, so it cannot pay for gas.
        {funding.state === "refused"
          ? ` The faucet did not send any: ${funding.faucetError}`
          : funding.state === "delayed"
            ? " The faucet sent some, but it has not arrived yet."
            : null}
      </p>
      {funding.canRequest ? (
        <Button size="sm" variant="outline" className="self-start" onClick={funding.request}>
          {funding.state === "empty" ? `Get ${coin}` : "Try again"}
        </Button>
      ) : null}
      <p className="text-muted-foreground">
        {officialFaucet ? (
          <>
            {funding.canRequest ? "You can also fund this wallet" : "Fund this wallet"} from
            the {officialFaucet} (needs a free Builder Hub sign-in). Its address:
          </>
        ) : (
          <>
            Send {coin} to this wallet on {chain.name} to continue. Its address:
          </>
        )}
      </p>
      <code className="font-mono break-all select-all">{address}</code>
    </div>
  );
}
