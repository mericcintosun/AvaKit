import { ConnectAvalanche } from "@avakit/react";
import { Demo } from "@/components/demo";
import { ThemeToggle } from "@/components/theme-toggle";

// A Server Component: the static shell renders on the server. `@avakit/react`
// ships as a client module, so its components drop straight into a server page
// like this one without a wrapper file.
export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">hello-avax</span>
        <div className="flex items-center gap-2">
          <ConnectAvalanche />
          <ThemeToggle />
        </div>
      </header>
      <Demo />
    </div>
  );
}
