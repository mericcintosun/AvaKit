import { Check, ExternalLink, Rocket, RotateCcw, Wallet } from "lucide-react";
import { useCallback } from "react";
import { BusyElsewhere } from "../components/BusyElsewhere";
import { Console } from "../components/Console";
import { CopyButton } from "../components/copy-button";
import type { View } from "../components/Sidebar";
import { useToast } from "../components/toast";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import type { FujiWizard } from "../hooks/useFujiWizard";
import { FUJI_STEPS, type FujiStep } from "../lib/fuji-wizard";
import { cancelWarning, consoleLines, LOST_NOTE, startFailureNotice } from "../lib/run-messages";
import { useRun } from "../run";

const MIN_FUND = 0.5; // enough for the P-Chain txs + a small validator balance

const STEP_LABEL: Record<FujiStep, string> = {
  fund: "Fund",
  transfer: "C→P transfer",
  deploy: "Deploy",
  live: "Live",
};

export function FujiView({
  hasCli,
  wizard,
  navigate,
}: {
  hasCli: boolean;
  wizard: FujiWizard;
  navigate: (v: View) => void;
}) {
  const toast = useToast();
  const { run, log, busy, lost, start, cancel, dismiss } = useRun();
  const { state, edit } = wizard;
  const { form, step, address, cBalance, balanceError, l1 } = state;

  const nameOk = /^[a-z][a-z0-9]{1,31}$/.test(form.name);
  const amountOk =
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(form.amount) && Number(form.amount) > 0;
  const chainIdOk = /^[1-9][0-9]{0,9}$/.test(form.chainId) && Number(form.chainId) <= 4294967295;
  const tokenOk = /^[A-Z][A-Z0-9]{0,7}$/.test(form.token);
  const funded = Number(cBalance) >= MIN_FUND;

  // This view's own run (a transfer or a deploy), if that is what is on screen.
  const mine = run?.kind === "fuji" ? run : null;
  const running = busy && mine ? mine.action : null;

  const launch = useCallback(
    async (action: "transfer" | "deploy") => {
      try {
        await start({
          kind: "fuji",
          action,
          name: form.name,
          chainId: form.chainId,
          symbol: form.token,
          amount: form.amount,
        });
      } catch (e) {
        toast(startFailureNotice(e));
      }
    },
    [start, form, toast],
  );

  const startOver = useCallback(() => {
    wizard.reset();
    // Forget the finished run too, or a reload would bring this step back.
    if (mine?.status === "done") void dismiss().catch(() => {});
  }, [wizard, mine, dismiss]);

  const addToWallet = useCallback(async () => {
    const eth = (window as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth || !l1?.rpcUrl || l1.evmChainId == null) return;
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${l1.evmChainId.toString(16)}`,
            chainName: form.name,
            rpcUrls: [l1.rpcUrl],
            nativeCurrency: { name: form.token, symbol: form.token, decimals: 18 },
          },
        ],
      });
      toast({
        title: "Added to wallet",
        description: "Your Fuji L1 is now in your wallet.",
        variant: "success",
      });
    } catch {
      /* rejected */
    }
  }, [l1, form, toast]);

  const stepIndex = FUJI_STEPS.indexOf(step);
  const locked = step !== "fund";

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Rocket className="size-4" />
          <p className="text-sm font-medium">Launch your L1 on the Fuji testnet</p>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          A guided, on-testnet deploy: fund a key, move funds to the P-Chain, and deploy a sovereign
          L1 with your local machine as its bootstrap validator. No CLI prompts — Studio drives it.
        </p>
        {!hasCli && (
          <p className="text-muted-foreground mt-2 text-xs">
            Install avalanche-cli (see Environment) to use this.
          </p>
        )}
      </Card>

      {/* Step tracker */}
      <div className="flex flex-wrap items-center gap-2">
        {FUJI_STEPS.map((s, i) => (
          <div
            key={s}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
              i === stepIndex
                ? "border-primary"
                : i < stepIndex
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50"
            }`}
          >
            <span
              className={`flex size-4 items-center justify-center rounded-full text-[0.6rem] ${
                i < stepIndex ? "bg-primary text-primary-foreground" : "border"
              }`}
            >
              {i < stepIndex ? <Check className="size-2.5" /> : i + 1}
            </span>
            {STEP_LABEL[s]}
          </div>
        ))}
        {locked && !busy && (
          <Button size="sm" variant="ghost" onClick={startOver} className="ml-auto">
            <RotateCcw className="size-3.5" /> Start over
          </Button>
        )}
      </div>

      {/* L1 config */}
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field
            label="L1 name"
            value={form.name}
            ok={nameOk}
            onChange={(v) => edit("name", v)}
            disabled={locked}
          />
          <Field
            label="Chain ID"
            value={form.chainId}
            ok={chainIdOk}
            onChange={(v) => edit("chainId", v)}
            disabled={locked}
          />
          <Field
            label="Token"
            value={form.token}
            ok={tokenOk}
            onChange={(v) => edit("token", v.toUpperCase())}
            disabled={locked}
          />
          <Field
            label="P-Chain amount"
            value={form.amount}
            ok={amountOk}
            onChange={(v) => edit("amount", v)}
            disabled={locked}
          />
        </div>
      </Card>

      <BusyElsewhere view="fuji" navigate={navigate} />

      {/* Step body */}
      {step === "fund" && (
        <Card className="p-5">
          <p className="text-sm font-medium">1 · Create + fund a key</p>
          {!address ? (
            <>
              <p className="text-muted-foreground mt-1 text-sm">
                The key is named after the L1 (<span className="font-mono">{form.name}</span>) and
                pays for everything that follows. An existing key with that name is reused.
              </p>
              <Button
                size="sm"
                className="mt-3"
                disabled={wizard.creatingKey || !hasCli || !nameOk}
                onClick={wizard.createKey}
              >
                {wizard.creatingKey ? "Creating…" : "Create key"}
              </Button>
            </>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  C-Chain address of key <span className="font-mono">{form.name}</span>
                </span>
                <span className="flex items-center gap-1.5 font-mono text-xs">
                  {address}
                  <CopyButton value={address} label="" />
                </span>
              </div>
              <a
                href="https://build.avax.network/console/primary-network/faucet"
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
              >
                Open the Fuji faucet, paste that address <ExternalLink className="size-3" />
              </a>
              <div className="flex items-center justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Dot state={funded ? "live" : "off"} />
                  Balance: <span className="font-mono">{cBalance} AVAX</span>
                  {balanceError ? (
                    <span className="text-muted-foreground text-xs">
                      (couldn't refresh: {balanceError} — retrying)
                    </span>
                  ) : (
                    !funded && (
                      <span className="text-muted-foreground text-xs">
                        (waiting for ≥ {MIN_FUND})
                      </span>
                    )
                  )}
                </span>
                <Button size="sm" disabled={!funded} onClick={wizard.next}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {step === "transfer" && (
        <Card className="p-5">
          <p className="text-sm font-medium">2 · Move {form.amount} AVAX to the P-Chain</p>
          <p className="text-muted-foreground mt-1 text-sm">
            L1 creation is paid from the P-Chain; the faucet funds the C-Chain. This cross-chain
            transfer bridges them.
          </p>
          <Button
            size="sm"
            className="mt-3"
            disabled={busy || !hasCli || !amountOk}
            onClick={() => launch("transfer")}
          >
            {running === "transfer" ? "Transferring…" : "Transfer C→P"}
          </Button>
        </Card>
      )}

      {step === "deploy" && (
        <Card className="p-5">
          <p className="text-sm font-medium">3 · Deploy the L1 to Fuji</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Creates the subnet + blockchain, converts it to a sovereign L1, and boots your machine
            as its validator. The node first syncs to Fuji (a few minutes) — that wait is normal,
            and it keeps going if you leave this view or reload the page.
          </p>
          <Button
            size="sm"
            className="mt-3"
            disabled={busy || !hasCli}
            onClick={() => launch("deploy")}
          >
            <Rocket className="size-4" />
            {running === "deploy" ? "Deploying…" : "Deploy to Fuji"}
          </Button>
        </Card>
      )}

      {step === "live" &&
        (l1?.rpcUrl ? (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Dot state={l1.running ? "live" : "on"} />
              <p className="text-sm font-medium">
                {l1.running ? "Your L1 is live on Fuji" : "Your L1 is deployed to Fuji"}
              </p>
            </div>
            {!l1.running && (
              <p className="text-muted-foreground mt-1 text-sm">
                {wizard.checkingL1
                  ? "Waiting for its RPC to answer…"
                  : "Its RPC is not answering yet — the validator node may still be starting."}
              </p>
            )}
            <div className="mt-3 space-y-2 text-xs">
              <Row k="Chain ID" v={l1.evmChainId != null ? String(l1.evmChainId) : "—"} />
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">RPC</span>
                <span className="flex items-center gap-1.5 font-mono">
                  {l1.rpcUrl.length > 42 ? `${l1.rpcUrl.slice(0, 42)}…` : l1.rpcUrl}
                  <CopyButton value={l1.rpcUrl} label="" />
                </span>
              </div>
              {l1.blockchainId && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Blockchain ID</span>
                  <span className="flex items-center gap-1.5 font-mono">
                    {l1.blockchainId.slice(0, 10)}…
                    <CopyButton value={l1.blockchainId} label="" />
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={addToWallet}>
                <Wallet className="size-4" /> Add to wallet
              </Button>
              {!l1.running && !wizard.checkingL1 && (
                <Button size="sm" variant="outline" onClick={wizard.recheckL1}>
                  Check again
                </Button>
              )}
            </div>
            <p className="text-muted-foreground mt-3 border-t pt-3 text-xs">
              ⚠︎ Your L1 produces blocks only while its validator node stays running, and the
              validator's balance drains over time — top it up or the chain goes inactive. Run the
              node on a server for an always-on L1.
            </p>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Dot state={wizard.checkingL1 ? "live" : "off"} />
              <p className="text-sm font-medium">
                {wizard.checkingL1 ? "Verifying your L1…" : "Deployed, but not confirmed yet"}
              </p>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {wizard.checkingL1
                ? "The deploy finished. Studio is waiting for avalanche-cli to record the L1's RPC endpoint."
                : `The deploy finished, but avalanche-cli has not recorded an RPC endpoint for “${form.name}” on Fuji. Check the console output below, then look again.`}
            </p>
            {!wizard.checkingL1 && (
              <Button size="sm" variant="outline" className="mt-3" onClick={wizard.recheckL1}>
                Check again
              </Button>
            )}
          </Card>
        ))}

      {mine && (
        <Console
          log={consoleLines(mine, log)}
          busy={busy}
          note={lost ? LOST_NOTE : undefined}
          onCancel={() => {
            if (window.confirm(cancelWarning(mine))) void cancel().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function Field({
  label,
  value,
  ok,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  ok: boolean;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-background rounded-lg border px-3 py-1.5 font-mono text-sm outline-none disabled:opacity-50 ${
          value && !ok ? "border-destructive" : ""
        }`}
      />
    </label>
  );
}
