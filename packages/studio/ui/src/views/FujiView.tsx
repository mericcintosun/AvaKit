import { Check, ExternalLink, Rocket, Terminal, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiPost, type FujiBalance, type FujiL1, streamFuji } from "../api";
import { CopyButton } from "../components/copy-button";
import { useToast } from "../components/toast";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

type Step = "fund" | "transfer" | "deploy" | "live";
const ORDER: Step[] = ["fund", "transfer", "deploy", "live"];
const MIN_FUND = 0.5; // enough for the P-Chain txs + a small validator balance

export function FujiView({ hasCli }: { hasCli: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: "myfujil1",
    chainId: "77777",
    token: "FUJ",
    amount: "0.3",
  });
  const [step, setStep] = useState<Step>("fund");
  const [address, setAddress] = useState<string | null>(null);
  const [cBalance, setCBalance] = useState<string>("0");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [l1, setL1] = useState<FujiL1 | null>(null);
  const termRef = useRef<HTMLPreElement>(null);

  const nameOk = /^[a-z][a-z0-9]{1,31}$/.test(form.name);
  const chainIdOk = /^[1-9][0-9]{0,9}$/.test(form.chainId) && Number(form.chainId) <= 4294967295;
  const tokenOk = /^[A-Z][A-Z0-9]{0,7}$/.test(form.token);
  const amountOk =
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(form.amount) && Number(form.amount) > 0;
  const funded = Number(cBalance) >= MIN_FUND;

  // biome-ignore lint/correctness/useExhaustiveDependencies: autoscroll on log growth
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [log]);

  // Poll the key's C-Chain balance while on the funding step.
  useEffect(() => {
    if (step !== "fund" || !address) return;
    let active = true;
    const tick = async () => {
      try {
        const b = await api<FujiBalance>(`/api/fuji/balance?name=${encodeURIComponent(form.name)}`);
        if (active) setCBalance(b.cBalance);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [step, address, form.name]);

  const createKey = useCallback(async () => {
    if (!nameOk) return;
    setBusy(true);
    try {
      const k = await apiPost<{ address: string | null }>("/api/fuji/key", { name: form.name });
      setAddress(k.address);
      if (!k.address)
        toast({ title: "Key error", description: "Could not create the key.", variant: "error" });
    } catch (e) {
      toast({
        title: "Key error",
        description: e instanceof Error ? e.message : "failed",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [nameOk, form.name, toast]);

  const runStream = useCallback(
    (action: "transfer" | "deploy") => {
      if (busy) return;
      setBusy(true);
      setLog([`▸ ${action}`]);
      streamFuji(
        action,
        { name: form.name, chainId: form.chainId, token: form.token, amount: form.amount },
        (line) => setLog((l) => [...l, line]),
        async (code) => {
          setLog((l) => [...l, code === 0 ? "✔ done" : `✖ exited (${code})`]);
          setBusy(false);
          if (code !== 0) {
            toast({
              title: "Step failed",
              description: "See the console below.",
              variant: "error",
            });
            return;
          }
          if (action === "transfer") {
            toast({
              title: "Funds on the P-Chain",
              description: "Now deploy your L1 to Fuji.",
              variant: "success",
            });
            setStep("deploy");
          } else {
            toast({
              title: "L1 deployed to Fuji",
              description: "Verifying it's live…",
              variant: "success",
            });
            // Poll for the deployed L1's RPC to come live.
            for (let i = 0; i < 20; i++) {
              const s = await api<FujiL1>(`/api/fuji/l1?name=${encodeURIComponent(form.name)}`);
              if (s.deployed) {
                setL1(s);
                if (s.running) break;
              }
              await new Promise((r) => setTimeout(r, 3000));
            }
            setStep("live");
          }
        },
      );
    },
    [busy, form, toast],
  );

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

  const stepIndex = ORDER.indexOf(step);

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
      <div className="flex flex-wrap gap-2">
        {ORDER.map((s, i) => (
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
            {{ fund: "Fund", transfer: "C→P transfer", deploy: "Deploy", live: "Live" }[s]}
          </div>
        ))}
      </div>

      {/* L1 config */}
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field
            label="L1 name"
            value={form.name}
            ok={nameOk}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            disabled={step !== "fund"}
          />
          <Field
            label="Chain ID"
            value={form.chainId}
            ok={chainIdOk}
            onChange={(v) => setForm((f) => ({ ...f, chainId: v }))}
            disabled={step !== "fund"}
          />
          <Field
            label="Token"
            value={form.token}
            ok={tokenOk}
            onChange={(v) => setForm((f) => ({ ...f, token: v.toUpperCase() }))}
            disabled={step !== "fund"}
          />
          <Field
            label="P-Chain amount"
            value={form.amount}
            ok={amountOk}
            onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
            disabled={step !== "fund"}
          />
        </div>
      </Card>

      {/* Step body */}
      {step === "fund" && (
        <Card className="p-5">
          <p className="text-sm font-medium">1 · Create + fund a key</p>
          {!address ? (
            <Button
              size="sm"
              className="mt-3"
              disabled={busy || !hasCli || !nameOk}
              onClick={createKey}
            >
              {busy ? "Creating…" : "Create key"}
            </Button>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">C-Chain address</span>
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
                <span className="flex items-center gap-2 text-sm">
                  <Dot state={funded ? "live" : "off"} />
                  Balance: <span className="font-mono">{cBalance} AVAX</span>
                  {!funded && (
                    <span className="text-muted-foreground text-xs">
                      (waiting for ≥ {MIN_FUND})
                    </span>
                  )}
                </span>
                <Button size="sm" disabled={!funded} onClick={() => setStep("transfer")}>
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
            disabled={busy || !amountOk}
            onClick={() => runStream("transfer")}
          >
            {busy ? "Transferring…" : "Transfer C→P"}
          </Button>
        </Card>
      )}

      {step === "deploy" && (
        <Card className="p-5">
          <p className="text-sm font-medium">3 · Deploy the L1 to Fuji</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Creates the subnet + blockchain, converts it to a sovereign L1, and boots your machine
            as its validator. The node first syncs to Fuji (a few minutes) — that wait is normal.
          </p>
          <Button size="sm" className="mt-3" disabled={busy} onClick={() => runStream("deploy")}>
            <Rocket className="size-4" />
            {busy ? "Deploying…" : "Deploy to Fuji"}
          </Button>
        </Card>
      )}

      {step === "live" && l1?.rpcUrl && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Dot state={l1.running ? "live" : "on"} />
            <p className="text-sm font-medium">Your L1 is live on Fuji</p>
          </div>
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
          </div>
          <p className="text-muted-foreground mt-3 border-t pt-3 text-xs">
            ⚠︎ Your L1 produces blocks only while its validator node stays running, and the
            validator's balance drains over time — top it up or the chain goes inactive. Run the
            node on a server for an always-on L1.
          </p>
        </Card>
      )}

      {log.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-muted/40 flex items-center justify-between border-b px-3 py-2">
            <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
              <Terminal className="size-3.5" /> console
            </span>
            <CopyButton value={log.join("\n")} label="Copy" />
          </div>
          <pre
            ref={termRef}
            className="max-h-96 overflow-auto bg-black p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-neutral-200"
          >
            {log.join("\n")}
          </pre>
        </div>
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
