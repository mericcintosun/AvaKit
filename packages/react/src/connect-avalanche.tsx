"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, LogOut, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useAvaKit } from "./provider.js";
import { Button } from "./ui.js";
import { cn, shortenAddress } from "./utils.js";

function DialogShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <Dialog.Content className="bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
        <div className="flex flex-col gap-1">
          <Dialog.Title className="font-semibold leading-none">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="text-muted-foreground text-sm">
              {description}
            </Dialog.Description>
          ) : null}
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export interface ConnectAvalancheProps {
  /** Label for the connect button. */
  label?: string;
  className?: string;
}

/**
 * Drop-in wallet button. Closed → opens a dialog of configured adapters
 * (social login, browser wallet). Connected → shows the address with a
 * disconnect option. Built on Radix Dialog + shadcn tokens.
 */
export function ConnectAvalanche({ label = "Connect wallet", className }: ConnectAvalancheProps) {
  const { status, address, adapters, activeAdapterId, error, connect, disconnect } = useAvaKit();
  const [open, setOpen] = useState(false);

  // Close the picker once a connection lands.
  useEffect(() => {
    if (status === "connected") {
      setOpen(false);
    }
  }, [status]);

  if (status === "connected" && address) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="outline" className={className}>
            <Wallet className="size-4" />
            {shortenAddress(address)}
          </Button>
        </Dialog.Trigger>
        <DialogShell title="Account">
          <p className="bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm break-all">
            {address}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              void disconnect();
            }}
          >
            <LogOut className="size-4" />
            Disconnect
          </Button>
        </DialogShell>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button className={className}>
          <Wallet className="size-4" />
          {label}
        </Button>
      </Dialog.Trigger>
      <DialogShell title="Connect a wallet" description="Choose how you want to sign in.">
        <div className="flex flex-col gap-2">
          {adapters.map((adapter) => {
            const isBusy = status === "connecting" && activeAdapterId === adapter.id;
            return (
              <Button
                key={adapter.id}
                variant="outline"
                className={cn("justify-between")}
                disabled={status === "connecting"}
                onClick={() => {
                  void connect(adapter.id);
                }}
              >
                <span>{adapter.name}</span>
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              </Button>
            );
          })}
          {error ? <p className="text-muted-foreground text-sm">{error.message}</p> : null}
        </div>
      </DialogShell>
    </Dialog.Root>
  );
}
