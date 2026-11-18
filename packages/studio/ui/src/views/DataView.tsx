import { Coins, ExternalLink, Image, Receipt, RotateCw, Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api, type DataSummary } from "../api";
import { CopyButton } from "../components/copy-button";
import { useToast } from "../components/toast";
import { Button } from "../components/ui/button";
import { Card, CardRow } from "../components/ui/card";
import { cn, formatUnits, shortHex } from "../lib/utils";

const NETWORKS = [
  { id: 43113, label: "Fuji", explorer: "https://testnet.snowtrace.io" },
  { id: 43114, label: "C-Chain", explorer: "https://snowtrace.io" },
] as const;

type Network = (typeof NETWORKS)[number];

/** What is on screen: the data together with the address and network it is FOR. */
interface Result {
  address: string;
  net: Network;
  data: DataSummary;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Coins;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase">
        <Icon className="size-3.5" /> {title}
        {count != null && <span className="text-muted-foreground/60">· {count}</span>}
      </h3>
      {children}
    </div>
  );
}

/** A section the Data API did not answer for: unknown, which is not the same as empty. */
function Unavailable({ what, reason }: { what: string; reason: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm">Couldn't load {what}.</p>
      <p className="text-muted-foreground mt-0.5 text-xs break-words">{reason}</p>
    </div>
  );
}

export function DataPanel() {
  const toast = useToast();
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number>(43113);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the latest lookup may put its answer on screen.
  const latest = useRef(0);

  const selected = NETWORKS.find((n) => n.id === chainId) ?? NETWORKS[0];

  const lookup = useCallback(
    async (addr: string, net: Network) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        toast({ title: "Invalid address", description: "Enter a 0x… address.", variant: "error" });
        return;
      }
      const id = ++latest.current;
      setLoading(true);
      // Whatever was on screen belongs to another address or network.
      setResult(null);
      try {
        const data = await api<DataSummary>(`/api/data?address=${addr}&chainId=${net.id}`);
        if (id === latest.current) setResult({ address: addr, net, data });
      } catch (e) {
        if (id === latest.current) {
          toast({
            title: "Lookup failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "error",
          });
        }
      } finally {
        if (id === latest.current) setLoading(false);
      }
    },
    [toast],
  );

  const errors = result?.data.errors ?? {};
  const failed = Object.keys(errors).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && lookup(address, selected)}
            placeholder="0x… address"
            className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-sm outline-none"
          />
          <div className="bg-muted flex rounded-md p-0.5">
            {NETWORKS.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (n.id === chainId) return;
                  setChainId(n.id);
                  // Results are for ONE network: look the same address up on
                  // the new one rather than leave the old rows under its name.
                  if (result) void lookup(result.address, n);
                }}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  chainId === n.id ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {n.label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            disabled={loading || !address}
            onClick={() => lookup(address, selected)}
          >
            <Search className="size-4" /> {loading ? "Looking up…" : "Look up"}
          </Button>
        </div>
        {!result && (
          <p className="text-muted-foreground text-xs">
            Paste any {selected.label} address to see its balances, NFTs, and transactions — via the
            AvaCloud Data API, no indexer.
          </p>
        )}
      </div>

      {result && (
        <div className="flex flex-col gap-6">
          {failed > 0 && (
            <div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
              <p className="text-sm">
                {failed === 4
                  ? "The Data API did not answer — nothing below is known yet."
                  : "Part of this could not be loaded. Those sections are unknown, not empty."}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => lookup(result.address, result.net)}
              >
                <RotateCw className="size-3.5" /> Retry
              </Button>
            </div>
          )}

          <Section icon={Coins} title="Balances">
            <Card>
              <CardRow>
                {errors.native ? (
                  <Unavailable what="the AVAX balance" reason={errors.native} />
                ) : (
                  <>
                    <span className="font-medium">{result.data.native?.symbol ?? "AVAX"}</span>
                    <span className="font-mono text-sm">
                      {result.data.native
                        ? formatUnits(result.data.native.balance, result.data.native.decimals)
                        : "0"}
                    </span>
                  </>
                )}
              </CardRow>
              {errors.tokens && (
                <CardRow>
                  <Unavailable what="token balances" reason={errors.tokens} />
                </CardRow>
              )}
              {result.data.tokens.map((t) => (
                <CardRow key={t.address}>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="text-muted-foreground text-xs">{t.name}</span>
                  </span>
                  <span className="font-mono text-sm">{formatUnits(t.balance, t.decimals)}</span>
                </CardRow>
              ))}
            </Card>
          </Section>

          <Section
            icon={Image}
            title="NFTs"
            count={errors.nfts ? undefined : result.data.nfts.length}
          >
            {errors.nfts ? (
              <Card className="p-4">
                <Unavailable what="NFTs" reason={errors.nfts} />
              </Card>
            ) : result.data.nfts.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {result.data.nfts.map((n) => (
                  <a
                    key={`${n.address}-${n.tokenId}`}
                    href={`${result.net.explorer}/token/${n.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-card hover:border-foreground/30 rounded-lg border p-3 transition-colors"
                  >
                    <p className="truncate text-sm font-medium">{n.name || n.symbol}</p>
                    <p className="text-muted-foreground font-mono text-xs">#{n.tokenId}</p>
                  </a>
                ))}
              </div>
            ) : (
              <Card className="p-4">
                <p className="text-muted-foreground text-sm">No NFTs held on {result.net.label}.</p>
              </Card>
            )}
          </Section>

          <Section
            icon={Receipt}
            title="Recent transactions"
            count={errors.transactions ? undefined : result.data.transactions.length}
          >
            <Card>
              {errors.transactions ? (
                <CardRow>
                  <Unavailable what="transactions" reason={errors.transactions} />
                </CardRow>
              ) : result.data.transactions.length ? (
                result.data.transactions.map((tx) => (
                  <CardRow key={tx.txHash}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          tx.status === "1" ? "bg-foreground" : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="font-mono text-xs">{tx.method || "transfer"}</span>
                      <a
                        href={`${result.net.explorer}/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-xs"
                      >
                        {shortHex(tx.txHash, 6)} <ExternalLink className="size-3" />
                      </a>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {timeAgo(tx.timestamp)}
                    </span>
                  </CardRow>
                ))
              ) : (
                <CardRow>
                  <span className="text-muted-foreground text-sm">No transactions.</span>
                </CardRow>
              )}
            </Card>
          </Section>

          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono">{shortHex(result.address, 8)}</span>
            <CopyButton value={result.address} label="" />
            <span>· {result.net.label} ·</span>
            <a
              href={`${result.net.explorer}/address/${result.address}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground inline-flex items-center gap-1"
            >
              on Snowtrace <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
