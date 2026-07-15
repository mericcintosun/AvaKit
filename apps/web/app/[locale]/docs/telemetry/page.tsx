import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Telemetry",
  description:
    "create-avalanche-app counts scaffolds anonymously. What is collected, what never is, and how to turn it off.",
  alternates: { canonical: "/docs/telemetry" },
};

export default function TelemetryDocs() {
  return (
    <>
      <DocHeader
        title="Telemetry"
        lead="create-avalanche-app counts scaffolds anonymously so we can show that AvaKit gets used. Here is exactly what that means, and how to turn it off."
      />

      <H2>Turn it off</H2>
      <P>Any one of these is enough, and they persist:</P>
      <CodeBlock
        code={`export AVAKIT_TELEMETRY_DISABLED=1      # or DO_NOT_TRACK=1
npm create avalanche-app@latest my-app -- --no-telemetry`}
        prefix="$"
      />
      <P>
        Changed your mind? <C>--telemetry</C> opts back in. It is also off automatically in CI — a
        robot's scaffold is not adoption, and counting it would let our own test suite inflate the
        number we publish.
      </P>

      <H2>Why we collect anything</H2>
      <P>
        AvaKit is asking the Avalanche ecosystem — Team1 grants, infraBUIDL(AI), Retro9000 — to back
        it, and every one of those asks the same question: does anyone actually use this? npm's
        download count is public but it cannot tell a human from a CI mirror, and it cannot say
        which template anyone picked. Roughly a hundred anonymous counters answer both, and they
        also tell us which templates to keep building.
      </P>

      <H2>What is sent</H2>
      <P>One small JSON body per scaffold, and nothing else. In full:</P>
      <CodeBlock
        code={`{
  "event": "scaffold",
  "anonymousId": "6f1d1b1e-0b3a-4c2f-9c5e-1a2b3c4d5e6f",
  "template": "nft-mint",
  "wallet": "injected",
  "chain": "fuji",
  "pm": "pnpm",
  "ok": true,
  "cliVersion": "0.3.0",
  "platform": "darwin",
  "nodeMajor": "22"
}`}
      />
      <P>
        <C>anonymousId</C> is a random UUID generated on your machine the first time you run the CLI
        and stored in <C>~/.config/avakit/config.json</C>. Nothing about your machine, your network,
        or you is derived from it — it exists only so we can tell "ten people ran it once" apart
        from "one person ran it ten times". Delete that file and you are a new person to us.
      </P>

      <H2>What is never sent</H2>
      <UL>
        <li>Your project name, or any file path</li>
        <li>Any code, any file contents, any contract address</li>
        <li>Any environment variable, key, or credential</li>
        <li>
          The text of an error — a failure reports only a coarse <C>errorKind</C> (<C>dir-exists</C>{" "}
          or <C>scaffold-failed</C>), because error messages carry paths
        </li>
        <li>Your IP. The collector is written never to store one</li>
      </UL>
      <Note>
        Rate limiting needs to tell callers apart, so the collector keys off{" "}
        <C>SHA-256(secret salt + your IP + today's date)</C>. That row is deleted the next day and
        cannot be walked back to an IP without the salt. Your <C>anonymousId</C> is hashed the same
        way, so even the random id never lands in the database.
      </Note>

      <H2>It cannot break your scaffold</H2>
      <P>
        Telemetry runs beside the work, never in front of it. If the collector is down, slow, or
        blocked by your firewall, the request is destroyed after 1.5 seconds and the CLI carries on
        as if nothing happened. A failure to report has never failed a scaffold and is not able to.
      </P>

      <H2>Check for yourself</H2>
      <P>
        Don't take our word for any of this. The client is about 200 lines in{" "}
        <A href="https://github.com/mericcintosun/AvaKit/blob/main/packages/create-avalanche-app/src/telemetry.ts">
          <C>src/telemetry.ts</C>
        </A>
        , the collector is in{" "}
        <A href="https://github.com/mericcintosun/AvaKit/tree/main/services/telemetry">
          <C>services/telemetry</C>
        </A>
        , and everything we count is public at <A href="/stats">avakit.dev/stats</A>. You can also
        just watch it: point the CLI at your own machine and read the request.
      </P>
      <CodeBlock
        code={`AVAKIT_TELEMETRY_URL=http://localhost:8787/e \\
  npm create avalanche-app@latest my-app -- --yes`}
        prefix="$"
      />

      <H2>Honesty about the numbers</H2>
      <P>
        Because this is self-reported by a client we don't control, and because opting out is easy
        and CI never counts, our scaffold count is a floor rather than a measurement — and a
        determined person could inflate it. We publish it next to the npm download count for exactly
        that reason: one is spoofable and specific, the other is independent and blunt. Treat both
        as evidence, not as audited figures.
      </P>

      <NextLinks
        items={[
          {
            label: "Stats",
            href: "/stats",
            description: "Everything these counters add up to, in public.",
          },
          {
            label: "create-avalanche-app",
            href: "/docs/cli",
            description: "The CLI that does the counting.",
          },
        ]}
      />
    </>
  );
}
