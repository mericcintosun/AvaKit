import type { Metadata } from "next";

import { pageMetadata } from "@/lib/metadata";

import { LiveDemo } from "./live-demo";

export const metadata: Metadata = pageMetadata({
  route: "/new",
  title: "Try it now — a real mint on Avalanche Fuji in about a minute",
  description:
    "No install, no signup, no seed phrase, no gas to pay. Get a temporary wallet funded with test AVAX, deploy an NFT contract and mint from it on the Avalanche Fuji testnet, right in your browser.",
});

export default function NewPage() {
  return <LiveDemo />;
}
