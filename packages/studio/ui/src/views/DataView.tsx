import { Coins, ExternalLink, Image, Receipt, Search } from "lucide-react";
import { useCallback, useState } from "react";
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

export function DataPanel() {
  const toast = useToast();
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number>(43113);
  const [data, setData] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const net = NETWORKS.find((n) => n.id === chainId) ?? NETWORKS[0];

  const lookup = useCallback(
    async (addr: string) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        toast({ title: "Invalid address", description: "Enter a 0x… address.", variant: "error" });
        return;
      }
      setLoading(true);
      try {
        setData(await api<DataSummary>(`/api/data?address=${addr}&chainId=${chainId}`));
      } catch (e) {
        toast({
          title: "Lookup failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "error",
        });
      } finally {
        setLoading(false);
      }
    },
    [chainId, toast],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && lookup(address)}
            placeholder="0x… address"
            className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-sm outline-none"
          />
          <div className="bg-muted flex rounded-md p-0.5">
            {NETWORKS.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setChainId(n.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  chainId === n.id ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {n.label}
              </button>
            ))}
          </div>
          <Button size="sm" disabled={loading || !address} onClick={() => lookup(address)}>
            <Search className="size-4" /> {loading ? "Looking up…" : "Look up"}
          </Button>
        </div>
        {!data && (
          <p className="text-muted-foreground text-xs">
            Paste any {net.label} address to see its balances, NFTs, and transactions — via the
            AvaCloud Data API, no indexer.
          </p>
        )}
      </div>

      {data && (
        <div className="flex flex-col gap-6">
          <Section icon={Coins} title="Balances">
            <Card>
              <CardRow>
                <span className="font-medium">{data.native?.symbol ?? "AVAX"}</span>
                <span className="font-mono text-sm">
                  {data.native ? formatUnits(data.native.balance, data.native.decimals) : "0"}
                </span>
              </CardRow>
              {data.tokens.map((t) => (
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

          <Section icon={Image} title="NFTs" count={data.nfts.length}>
            {data.nfts.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {data.nfts.map((n) => (
                  <a
                    key={`${n.address}-${n.tokenId}`}
                    href={`${net.explorer}/token/${n.address}`}
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
                <p className="text-muted-foreground text-sm">No NFTs held on {net.label}.</p>
              </Card>
            )}
          </Section>

          <Section icon={Receipt} title="Recent transactions" count={data.transactions.length}>
            <Card>
              {data.transactions.length ? (
                data.transactions.map((tx) => (
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
                        href={`${net.explorer}/tx/${tx.txHash}`}
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

          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="font-mono">{shortHex(address, 8)}</span>
            <CopyButton value={address} label="" />
            <a
              href={`${net.explorer}/address/${address}`}
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
