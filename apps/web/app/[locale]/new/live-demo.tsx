"use client";

import { burnerAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import {
  AvaKitProvider,
  useAvaDeploy,
  useAvaKit,
  useBalance,
  useContract,
  useFaucet,
} from "@avakit/react";
import { motion } from "framer-motion";
import {
  Check,
  Coins,
  ExternalLink,
  Loader2,
  Rocket,
  Share2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Address, formatEther, type Hex } from "viem";

import { Button } from "@/components/ui/button";
import { abi, bytecode } from "@/lib/nft-artifact";

/* avakit.dev/new — the zero-barrier proof.
   A stranger lands here and does a REAL Avalanche Fuji transaction in about a
   minute: a temporary wallet appears, it gets funded, they deploy an ERC-721 and
   mint it. No install, no signup, no seed phrase, no gas of their own.

   Everything runs on the published @avakit/* packages — the same ones
   `npm create avalanche-app@latest` installs — so this page is also the honest
   dogfood test. */

/** AvaKit-hosted faucet that drips Fuji AVAX (see services/faucet). */
const FAUCET_URL = process.env.NEXT_PUBLIC_AVAKIT_FAUCET_URL;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type StepState = "todo" | "active" | "done";

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Pre-filled post. Same voice as the launch calendar: lowercase, human, one 🔺. */
function shareUrl(txHash: string) {
  const text = `just deployed an nft contract and minted from it on Avalanche.

no install, no signup, no seed phrase, no gas. about a minute, in the browser.

my mint: ${fuji.explorerUrl}/tx/${txHash}

try it yourself 🔺`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://avakit.dev/new")}`;
}

function Step({
  index,
  title,
  state,
  icon: Icon,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  icon: typeof Wallet;
  children?: React.ReactNode;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
      className="flex gap-4"
    >
      <div className="flex flex-col items-center">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
            state === "done"
              ? "border-primary/50 bg-primary/10 text-primary"
              : state === "active"
                ? "border-primary text-primary"
                : "border-border text-muted-foreground"
          }`}
        >
          {state === "done" ? <Check className="size-4" /> : <Icon className="size-4" />}
        </span>
        {index < 3 ? <span className="bg-border mt-1 w-px flex-1" /> : null}
      </div>
      <div className="flex-1 pb-8">
        <p
          className={`text-sm font-medium ${state === "todo" ? "text-muted-foreground" : "text-foreground"}`}
        >
          {title}
        </p>
        <div className="mt-2">{children}</div>
      </div>
    </motion.li>
  );
}

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:opacity-80"
    >
      {label}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

function Flow() {
  const { status, connect, address } = useAvaKit();
  const { data: balance, refetch: refetchBalance } = useBalance();
  const faucet = useFaucet();
  const { deploy, status: deployStatus } = useAvaDeploy();

  const [contractAddress, setContractAddress] = useState<Address | null>(null);
  const [mintHash, setMintHash] = useState<Hex | null>(null);
  const [nft, setNft] = useState<{ name: string; image: string } | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectTried = useRef(false);

  const contract = useContract({ address: contractAddress ?? ZERO, abi });

  // Always hand the visitor a throwaway wallet. We deliberately do NOT use their
  // injected wallet here — a demo should never touch a real account.
  useEffect(() => {
    if (status === "disconnected" && !connectTried.current) {
      connectTried.current = true;
      void connect("burner");
    }
  }, [status, connect]);

  // While waiting for the faucet drip to land, poll the balance.
  const funded = (balance ?? 0n) > 0n;
  useEffect(() => {
    if (!address || funded) return;
    const id = setInterval(() => void refetchBalance(), 2500);
    return () => clearInterval(id);
  }, [address, funded, refetchBalance]);

  async function onDeploy() {
    setError(null);
    try {
      const result = await deploy({ abi, bytecode });
      setContractAddress(result.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onMint() {
    setError(null);
    setMinting(true);
    try {
      const hash = await contract.write("mint", []);
      setMintHash(hash);
      void refetchBalance();
      // Show them the thing they just made. The art is fully on-chain, so this
      // reads straight from the contract — no IPFS, no indexer, no server.
      try {
        const tokenId = (await contract.read("totalSupply")) as bigint;
        const uri = (await contract.read("tokenURI", [tokenId])) as string;
        const json = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1))) as {
          name: string;
          image: string;
        };
        setNft({ name: json.name, image: json.image });
      } catch {
        // Metadata is a bonus — never let it break the mint that already landed.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }

  const walletState: StepState = address ? "done" : "active";
  const fundState: StepState = funded ? "done" : address ? "active" : "todo";
  const deployState: StepState = contractAddress ? "done" : funded ? "active" : "todo";
  const mintState: StepState = mintHash ? "done" : contractAddress ? "active" : "todo";

  return (
    <ol className="mt-10">
      <Step index={0} title="A wallet appears" state={walletState} icon={Wallet}>
        {address ? (
          <p className="text-muted-foreground font-mono text-sm">
            {short(address)}{" "}
            <span className="text-muted-foreground/70">· temporary, in this browser</span>
          </p>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" /> creating one for you…
          </p>
        )}
      </Step>

      <Step index={1} title="It gets funded" state={fundState} icon={Coins}>
        {funded ? (
          <p className="text-muted-foreground text-sm">
            {formatEther(balance ?? 0n).slice(0, 8)} AVAX on Fuji testnet
          </p>
        ) : address ? (
          faucet.enabled ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" /> dripping test AVAX…
            </p>
          ) : (
            // No AvaKit faucet configured for this deployment — stay honest and
            // hand the visitor the official one rather than pretending.
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                This demo has no faucet configured yet. Grab test AVAX for{" "}
                <span className="font-mono">{address ? short(address) : ""}</span>:
              </p>
              <ExplorerLink
                href="https://core.app/tools/testnet-faucet/"
                label="Open the Fuji faucet"
              />
            </div>
          )
        ) : (
          <p className="text-muted-foreground text-sm">waiting for the wallet…</p>
        )}
      </Step>

      <Step index={2} title="You deploy a real NFT contract" state={deployState} icon={Rocket}>
        {contractAddress ? (
          <ExplorerLink
            href={`${fuji.explorerUrl}/address/${contractAddress}`}
            label={`${short(contractAddress)} — live on Fuji`}
          />
        ) : (
          <Button size="sm" disabled={!funded || deployStatus === "deploying"} onClick={onDeploy}>
            {deployStatus === "deploying" ? (
              <>
                <Loader2 className="size-4 animate-spin" /> deploying…
              </>
            ) : (
              <>
                <Rocket className="size-4" /> Deploy it
              </>
            )}
          </Button>
        )}
      </Step>

      <Step index={3} title="You mint from it" state={mintState} icon={Sparkles}>
        {mintHash ? (
          <div className="flex flex-col gap-3">
            <ExplorerLink
              href={`${fuji.explorerUrl}/tx/${mintHash}`}
              label="See your mint on Fuji"
            />

            {nft ? (
              <div className="flex items-center gap-4">
                {/* biome-ignore lint/performance/noImgElement: an on-chain SVG data URI, not a remote asset */}
                <img
                  src={nft.image}
                  alt={nft.name}
                  className="border-border size-28 rounded-xl border"
                />
                <div>
                  <p className="font-mono text-sm font-medium">{nft.name}</p>
                  <p className="text-muted-foreground text-xs">
                    yours · the art lives on-chain, inside the contract you just deployed
                  </p>
                </div>
              </div>
            ) : null}

            <div className="border-primary/30 bg-primary/5 rounded-lg border p-4">
              <p className="text-sm font-medium">That was a real transaction on Avalanche. 🔺</p>
              <p className="text-muted-foreground mt-1 text-sm">
                No install, no signup, no seed phrase, no gas. Now build one of your own:
              </p>
              <pre className="bg-background/70 mt-3 overflow-x-auto rounded-md border p-3 font-mono text-xs">
                npm create avalanche-app@latest
              </pre>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <a href={shareUrl(mintHash)} target="_blank" rel="noreferrer">
                  <Share2 className="size-4" />
                  Share it
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" disabled={!contractAddress || minting} onClick={onMint}>
            {minting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> minting…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Mint one
              </>
            )}
          </Button>
        )}
      </Step>

      {error ? (
        <li className="text-muted-foreground border-border ml-13 rounded-md border p-3 text-sm">
          {error}
        </li>
      ) : null}
    </ol>
  );
}

export function LiveDemo() {
  const adapters = useMemo(() => [burnerAdapter({ chain: fuji })], []);

  return (
    <main className="relative mx-auto max-w-2xl px-6 py-20 sm:py-28">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <span className="border-primary/35 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.2em] uppercase">
          <Sparkles className="size-3.5" />
          Live on Fuji
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
          A real Avalanche transaction, <span className="text-primary">in about a minute</span>.
        </h1>
        <p className="text-muted-foreground mt-4 text-base leading-relaxed">
          No install. No signup. No seed phrase. No gas. This runs on the same{" "}
          <code className="bg-foreground/10 rounded px-1 py-0.5 text-[13px]">@avakit</code> packages{" "}
          <code className="bg-foreground/10 rounded px-1 py-0.5 text-[13px]">
            npm create avalanche-app
          </code>{" "}
          gives you.
        </p>
      </motion.div>

      <AvaKitProvider
        chains={[fuji]}
        adapters={adapters}
        {...(FAUCET_URL ? { faucetUrl: FAUCET_URL } : {})}
      >
        <Flow />
      </AvaKitProvider>
    </main>
  );
}
