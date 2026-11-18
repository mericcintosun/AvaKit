import type { Metadata } from "next";

import { pageMetadata } from "@/lib/metadata";

import { LiveDemo } from "./live-demo";

export const metadata: Metadata = pageMetadata({
  route: "/new",
  title: "Try it now — a real Avalanche mint in about a minute",
  description:
    "No install, no signup, no seed phrase, no gas. Get a wallet, deploy an NFT contract and mint from it on Avalanche Fuji, right in your browser.",
});

export default function NewPage() {
  return <LiveDemo />;
}
