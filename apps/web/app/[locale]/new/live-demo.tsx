"use client";

import { burnerAdapter, FaucetError, getPublicClient, requestFaucet } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { AvaKitProvider, useAvaDeploy, useAvaKit, useBalance, useContract } from "@avakit/react";
import { motion } from "framer-motion";
import {
  Check,
  Coins,
  Copy,
  ExternalLink,
  Loader2,
  Rocket,
  RotateCw,
  Share2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
/** The public Fuji faucet: the way forward whenever ours can't fund the wallet. */
const PUBLIC_FAUCET_URL = fuji.faucetUrl ?? "https://core.app/tools/testnet-faucet/";
/** A faucet that takes the request and then stalls is a failure, not a wait. */
const FAUCET_TIMEOUT_MS = 20_000;
/** A drip lands within seconds. Past this, stop implying it is on its way. */
const DRIP_SLOW_MS = 30_000;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type StepState = "todo" | "active" | "done";

/** Where the faucet drip for the current wallet stands. */
type Drip =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "sent"; txHash: Hex | null }
  | { state: "failed"; reason: string };

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Why a drip failed, as one sentence the visitor can act on. */
function dripFailure(e: unknown) {
  // requestFaucet throws a FaucetError that carries the HTTP status when the
  // faucet answered with a refusal (empty, rate-limited, …) and no status when
  // it never answered at all (offline, blocked, timed out).
  if (e instanceof FaucetError && e.status !== undefined) {
    const reason = (e.message.split("\n")[0] ?? e.message).slice(0, 160);
    return `Our faucet couldn't fund this wallet: ${reason}`;
  }
  return "Our faucet didn't answer.";
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

/** The way forward when our faucet can't fund the wallet, or isn't configured. */
function FundManually({
  address,
  onRetry,
  children,
}: {
  address: Address;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the address is on the page in full and selectable.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-foreground text-sm">
        {children}
      </p>
      <p className="text-muted-foreground text-sm">
        You can fund this wallet yourself. Send it test AVAX from the public faucet and this page
        carries on by itself as soon as it lands:
      </p>
      <code className="bg-foreground/10 w-fit rounded px-2 py-1 font-mono text-xs break-all">
        {address}
      </code>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onRetry ? (
          <Button size="sm" onClick={onRetry}>
            <RotateCw className="size-4" /> Try our faucet again
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy address"}
        </Button>
        <ExplorerLink href={PUBLIC_FAUCET_URL} label="Open the public Fuji faucet" />
      </div>
    </div>
  );
}

function Flow() {
  const { status, connect, address, error: walletError } = useAvaKit();
  const { data: balance, refetch: refetchBalance } = useBalance();
  const { deploy, status: deployStatus } = useAvaDeploy();

  const [contractAddress, setContractAddress] = useState<Address | null>(null);
  const [mintHash, setMintHash] = useState<Hex | null>(null);
  const [nft, setNft] = useState<{ name: string; image: string } | null>(null);
  const [nftLoading, setNftLoading] = useState(false);
  const [minting, setMinting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drip, setDrip] = useState<Drip>({ state: "idle" });
  const [dripSlow, setDripSlow] = useState(false);
  const connectTried = useRef(false);
  const drippedFor = useRef<Address | null>(null);

  const contract = useContract({ address: contractAddress ?? ZERO, abi });

  // Nothing happens until the visitor asks for it. Auto-starting on page load
  // would spend real faucet funds on every crawler, link preview and idle tab —
  // and it's rude to make a wallet for someone who was only looking.
  //
  // Always a throwaway wallet: we deliberately do NOT touch their injected one.
  useEffect(() => {
    if (!started || status !== "disconnected" || connectTried.current) {
      return;
    }
    connectTried.current = true;
    void connect("burner");
  }, [started, status, connect]);

  // While waiting for the faucet drip to land, poll the balance.
  const funded = (balance ?? 0n) > 0n;
  useEffect(() => {
    if (!address || funded) return;
    const id = setInterval(() => void refetchBalance(), 2500);
    return () => clearInterval(id);
  }, [address, funded, refetchBalance]);

  // This page asks the faucet itself instead of handing `faucetUrl` to
  // <AvaKitProvider>: the provider's auto-fund swallows a refusal and never
  // retries, which would leave the visitor on a spinner with no reason and no
  // way forward. Here every outcome ends in a state the step below can render.
  const requestDrip = useCallback(async (to: Address) => {
    if (!FAUCET_URL) return;
    drippedFor.current = to;
    setDripSlow(false);
    setDrip({ state: "requesting" });
    try {
      const result = await requestFaucet({
        url: FAUCET_URL,
        address: to,
        chainId: fuji.id,
        signal: AbortSignal.timeout(FAUCET_TIMEOUT_MS),
      });
      setDrip({ state: "sent", txHash: result.txHash ?? null });
    } catch (e) {
      setDrip({ state: "failed", reason: dripFailure(e) });
    }
  }, []);

  // One automatic request per wallet, and only once the wallet is known to be
  // empty: the burner persists in this browser, so a returning visitor may still
  // hold test AVAX and has no use for another drip.
  useEffect(() => {
    if (!address || balance !== 0n || drippedFor.current === address) return;
    void requestDrip(address);
  }, [address, balance, requestDrip]);

  // Each step toward a funded wallet normally takes a second or two. When one
  // of them hangs (the balance can't be read, or a drip that was sent never
  // shows up), say so and offer the way out rather than spinning forever.
  useEffect(() => {
    if (!FAUCET_URL || !address || funded || drip.state === "failed") return;
    const id = setTimeout(() => setDripSlow(true), DRIP_SLOW_MS);
    return () => clearTimeout(id);
  }, [address, funded, drip.state]);

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
      setNftLoading(true);
      try {
        // `write` resolves as soon as the tx is broadcast, so the mint has NOT
        // landed yet. Reading totalSupply here without waiting races the pending
        // tx and yields the pre-mint value (token 0, which doesn't exist).
        const receipt = await getPublicClient(fuji).waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          throw new Error("Mint reverted.");
        }
        const tokenId = (await contract.read("totalSupply")) as bigint;
        const uri = (await contract.read("tokenURI", [tokenId])) as string;
        const json = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1))) as {
          name: string;
          image: string;
        };
        setNft({ name: json.name, image: json.image });
      } catch {
        // Metadata is a bonus — never let it break the mint that already landed.
      } finally {
        setNftLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }

  if (!started) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mt-10 flex flex-col items-start gap-4"
      >
        <Button size="lg" onClick={() => setStarted(true)}>
          <Sparkles className="size-4" />
          Let&apos;s go
        </Button>
        <p className="text-muted-foreground text-sm">
          Four steps, about a minute. We&apos;ll make you a temporary wallet and cover the gas —
          nothing to install, nothing to sign up for.
        </p>
      </motion.div>
    );
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
        ) : walletError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-foreground text-sm">
              Couldn&apos;t create the wallet: {walletError.message}
            </p>
            <Button size="sm" onClick={() => void connect("burner")}>
              <RotateCw className="size-4" /> Try again
            </Button>
          </div>
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
        ) : !address ? (
          <p className="text-muted-foreground text-sm">waiting for the wallet…</p>
        ) : !FAUCET_URL ? (
          // No AvaKit faucet configured for this deployment — stay honest and
          // hand the visitor the official one rather than pretending.
          <FundManually address={address}>This demo has no faucet configured yet.</FundManually>
        ) : drip.state === "failed" ? (
          <FundManually address={address} onRetry={() => void requestDrip(address)}>
            {drip.reason}
          </FundManually>
        ) : dripSlow ? (
          <FundManually address={address} onRetry={() => void requestDrip(address)}>
            {drip.state === "sent" ? (
              <>
                Our faucet sent the test AVAX, but it hasn&apos;t arrived yet.
                {drip.txHash ? (
                  <>
                    {" "}
                    <ExplorerLink
                      href={`${fuji.explorerUrl}/tx/${drip.txHash}`}
                      label="See the faucet's transaction"
                    />
                  </>
                ) : null}
              </>
            ) : (
              "Funding this wallet is taking longer than it should."
            )}
          </FundManually>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            {drip.state === "idle" ? "checking the wallet…" : "dripping test AVAX…"}
          </p>
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

            {/* The mint has to be mined before the art exists, so hold the exact
                shape of the card while we wait — no layout jump when it lands. */}
            {nftLoading && !nft ? (
              <div className="flex items-center gap-4">
                <div className="border-border bg-muted/40 size-28 animate-pulse rounded-xl border" />
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-3.5 animate-spin" />
                    waiting for the mint to land…
                  </p>
                  <p className="text-muted-foreground/70 text-xs">
                    then we read your art straight off the chain
                  </p>
                </div>
              </div>
            ) : null}

            {nft ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-4"
              >
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
              </motion.div>
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

      {/* No `faucetUrl` here on purpose: <Flow> requests the drip itself so that
          a refusal reaches the visitor (see requestDrip). Passing it as well
          would make the provider send a second, silent request for the wallet. */}
      <AvaKitProvider chains={[fuji]} adapters={adapters}>
        <Flow />
      </AvaKitProvider>
    </main>
  );
}
