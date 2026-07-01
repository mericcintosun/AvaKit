"use client";

import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { useSendTransaction } from "./hooks.js";
import { Button } from "./ui.js";
import { cn } from "./utils.js";

export interface TransactionButtonProps {
  /** Recipient address. */
  to: Address;
  /** Value in wei. */
  value?: bigint;
  /** Optional calldata. */
  data?: Hex;
  children?: ReactNode;
  className?: string;
  onSuccess?: (hash: Hex) => void;
  onError?: (error: Error) => void;
}

/**
 * One-click transaction button: sends from the connected wallet, shows a
 * pending state, and reveals an explorer link on success. Built on shadcn/ui.
 */
export function TransactionButton({
  to,
  value,
  data,
  children = "Send transaction",
  className,
  onSuccess,
  onError,
}: TransactionButtonProps) {
  const { send, status, isPending, explorerUrl } = useSendTransaction();

  async function handleClick() {
    try {
      const hash = await send({ to, value, data });
      onSuccess?.(hash);
    } catch (e) {
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button onClick={handleClick} disabled={isPending}>
        {isPending ? "Confirming…" : children}
      </Button>
      {status === "success" && explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground text-center text-xs underline underline-offset-4"
        >
          View on explorer ↗
        </a>
      ) : null}
    </div>
  );
}
