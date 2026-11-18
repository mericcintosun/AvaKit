// `cn` comes from the server-safe "@avakit/react/utils" entry: this layout is a
// Server Component, and the main "@avakit/react" entry is a client module whose
// functions cannot be called on the server.
import { cn } from "@avakit/react/utils";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "hello-avax — AvaKit demo",
  description:
    "Connect a wallet, read your balance, and send a first transaction on Avalanche Fuji.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={cn(geistSans.variable, geistMono.variable, "font-sans antialiased")}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
