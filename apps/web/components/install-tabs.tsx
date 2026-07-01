"use client";

import { CodeBlock } from "@/components/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const managers = ["pnpm", "npm", "yarn", "bun"] as const;
type Manager = (typeof managers)[number];

function installCmd(pkg: string, m: Manager) {
  if (m === "npm") return `npm install ${pkg}`;
  if (m === "yarn") return `yarn add ${pkg}`;
  return `${m} add ${pkg}`;
}

export function InstallTabs({ pkg }: { pkg: string }) {
  return (
    <Tabs defaultValue="pnpm" className="w-full">
      <TabsList>
        {managers.map((m) => (
          <TabsTrigger key={m} value={m}>
            {m}
          </TabsTrigger>
        ))}
      </TabsList>
      {managers.map((m) => (
        <TabsContent key={m} value={m}>
          <CodeBlock code={installCmd(pkg, m)} prefix="$" />
        </TabsContent>
      ))}
    </Tabs>
  );
}
