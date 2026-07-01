import type { Inventory, ToolInfo } from "../api";
import { CopyButton } from "../components/copy-button";
import { Dot } from "../components/ui/badge";
import { Card, CardRow } from "../components/ui/card";

const MCP_CONFIG = `{
  "mcpServers": {
    "avakit-studio": {
      "command": "npx",
      "args": ["-y", "@avakit/studio", "mcp"]
    }
  }
}`;

function ToolRow({ t }: { t: ToolInfo }) {
  return (
    <CardRow>
      <div className="flex min-w-0 items-center gap-2.5">
        <Dot state={t.installed ? "on" : "off"} />
        <span className="font-medium">{t.name}</span>
      </div>
      {t.installed ? (
        <span className="text-muted-foreground font-mono text-xs">{t.version ?? "installed"}</span>
      ) : (
        <span className="text-muted-foreground max-w-[60%] truncate font-mono text-[0.7rem]">
          {t.hint ? `install: ${t.hint}` : "not installed"}
        </span>
      )}
    </CardRow>
  );
}

export function EnvironmentView({ env }: { env: Inventory | null }) {
  if (!env) return null;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-widest uppercase">
          Toolchain
        </h3>
        <Card>
          {env.tools.map((t) => (
            <ToolRow key={t.name} t={t} />
          ))}
        </Card>
      </div>

      <div>
        <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-widest uppercase">
          Project
        </h3>
        <Card>
          <CardRow>
            <div className="flex items-center gap-2.5">
              <Dot state={env.project.isAvaKit ? "on" : "off"} />
              <span className="font-medium">{env.project.name ?? "(no package.json here)"}</span>
            </div>
            <span className="text-muted-foreground font-mono text-xs">
              {env.project.isAvaKit ? "AvaKit project" : "not an AvaKit project"}
            </span>
          </CardRow>
          {env.project.template && (
            <CardRow>
              <span className="font-medium">Template</span>
              <span className="text-muted-foreground font-mono text-xs">
                {env.project.template}
              </span>
            </CardRow>
          )}
          <CardRow>
            <span className="font-medium">Contracts</span>
            <span className="text-muted-foreground font-mono text-xs">
              {env.project.hasContracts ? "Foundry ✓" : "—"}
            </span>
          </CardRow>
          <CardRow>
            <span className="font-medium">Working directory</span>
            <span className="text-muted-foreground max-w-[60%] truncate font-mono text-xs">
              {env.cwd}
            </span>
          </CardRow>
        </Card>
      </div>

      <div>
        <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-widest uppercase">
          Connect an AI agent
        </h3>
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">
            Studio is also an MCP server. Point Claude Code or Cursor at it to drive devnets, ICM,
            and data lookups from your agent — the same actions, agent-side.
          </p>
          <div className="bg-muted/40 mt-3 overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <span className="text-muted-foreground font-mono text-xs">mcp.json</span>
              <CopyButton value={MCP_CONFIG} label="Copy" />
            </div>
            <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed">{MCP_CONFIG}</pre>
          </div>
        </Card>
      </div>
    </div>
  );
}
