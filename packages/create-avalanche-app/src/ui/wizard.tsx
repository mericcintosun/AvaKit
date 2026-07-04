import { ConfirmInput, Select, Spinner, TextInput, ThemeProvider } from "@inkjs/ui";
import { Box, render, Text, useApp } from "ink";
import { useEffect, useMemo, useState } from "react";
import { C, crimsonAt, uiTheme } from "./theme.js";

// ── The shared AvaKit logo ────────────────────────────────────────────────
const MOUNTAIN = [
  "        /\\",
  "       /  \\",
  "      / /\\ \\",
  "     / /  \\ \\",
  "    /_/____\\_\\",
];
const WORDMARK = [
  " █████╗ ██╗   ██╗ █████╗ ██╗  ██╗██╗████████╗",
  "██╔══██╗██║   ██║██╔══██╗██║ ██╔╝██║╚══██╔══╝",
  "███████║██║   ██║███████║█████╔╝ ██║   ██║",
  "██╔══██║╚██╗ ██╔╝██╔══██║██╔═██╗ ██║   ██║",
  "██║  ██║ ╚████╔╝ ██║  ██║██║  ██╗██║   ██║",
  "╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝",
];

// ── Types ─────────────────────────────────────────────────────────────────
export type Answers = {
  projectName: string;
  template: string;
  wallet: string;
  chain: string;
  pm: string;
};
export type TemplateInfo = { id: string; title: string; description: string };

/** A command to optionally run for the user once scaffolding finishes. */
export type StartCommand = { command: string[]; cwd: string; label: string };

export type WizardProps = {
  version: string;
  templates: TemplateInfo[];
  presets: Partial<Answers>;
  scaffold: (a: Answers) => Promise<{ created: number }>;
  install: ((a: Answers) => boolean) | null;
  nextSteps: (a: Answers) => string[];
  /** If it returns a command, the wizard offers to run it (e.g. the dev server). */
  startCommand: (a: Answers) => StartCommand | null;
  /** Called once before exit with the command the user chose to run, or null. */
  onFinish: (start: StartCommand | null) => void;
};

type StepKey = keyof Answers;
const STEP_ORDER: StepKey[] = ["projectName", "template", "wallet", "chain", "pm"];
const LABELS: Record<StepKey, string> = {
  projectName: "Project name",
  template: "Template",
  wallet: "Wallet",
  chain: "Network",
  pm: "Package manager",
};
const HINT = "↑/↓ to navigate · Enter to confirm";

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

// ── Banner ────────────────────────────────────────────────────────────────
function Banner() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {MOUNTAIN.map((line) => (
        <Text key={line} bold color={C.white}>
          {line}
        </Text>
      ))}
      {WORDMARK.map((line, i) => (
        <Text
          key={line}
          bold
          color={crimsonAt(WORDMARK.length > 1 ? i / (WORDMARK.length - 1) : 0)}
        >
          {line}
        </Text>
      ))}
      <Text color={C.dim}> Avalanche, one command.</Text>
    </Box>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={C.crimson}
      paddingX={2}
      paddingY={1}
    >
      {children}
    </Box>
  );
}

function displayValue(templates: TemplateInfo[], key: StepKey, value: string): string {
  if (key === "template") return templates.find((t) => t.id === value)?.title ?? value;
  if (key === "wallet")
    return value === "web3auth"
      ? "Social login (Google, Apple, email)"
      : "Browser wallet (Core / MetaMask)";
  if (key === "chain") return value === "c-chain" ? "C-Chain (mainnet)" : "Fuji testnet";
  return value;
}

function optionsFor(key: StepKey, templates: TemplateInfo[]): { label: string; value: string }[] {
  switch (key) {
    case "template":
      return templates.map((t) => ({ label: t.title, value: t.id }));
    case "wallet":
      return [
        { label: "Social login (Google, Apple, email)", value: "web3auth" },
        { label: "Browser wallet (Core / MetaMask)", value: "injected" },
      ];
    case "chain":
      return [
        { label: "Fuji testnet  ·  recommended", value: "fuji" },
        { label: "C-Chain (mainnet)", value: "c-chain" },
      ];
    case "pm":
      return ["pnpm", "npm", "yarn", "bun"].map((m) => ({ label: m, value: m }));
    default:
      return [];
  }
}

// ── The wizard ──────────────────────────────────────────────────────────────
function App(props: WizardProps) {
  const { exit } = useApp();
  const askSteps = useMemo(() => STEP_ORDER.filter((k) => !props.presets[k]), [props.presets]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Partial<Answers>>({ ...props.presets });
  const [phase, setPhase] = useState<"form" | "scaffolding" | "done" | "error">(
    askSteps.length ? "form" : "scaffolding",
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [created, setCreated] = useState(0);
  const [scaffoldState, setScaffoldState] = useState<"running" | "done">("running");
  const [installState, setInstallState] = useState<"pending" | "running" | "done" | "warn">(
    props.install ? "pending" : "done",
  );
  const [error, setError] = useState<string | null>(null);
  const [startCmd, setStartCmd] = useState<StartCommand | null>(null);

  const currentKey = askSteps[idx];

  // Run scaffolding + install when we enter that phase.
  useEffect(() => {
    if (phase !== "scaffolding") return;
    let alive = true;
    (async () => {
      try {
        const result = await props.scaffold(answers as Answers);
        if (!alive) return;
        setCreated(result.created);
        setScaffoldState("done");
        if (props.install) {
          setInstallState("running");
          const ok = props.install(answers as Answers);
          if (!alive) return;
          setInstallState(ok ? "done" : "warn");
        }
        setPhase("done");
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [phase, answers, props]);

  // On completion: offer to start the dev server if eligible; otherwise finish.
  useEffect(() => {
    if (phase === "error") {
      process.exitCode = 1;
      props.onFinish(null);
      const t = setTimeout(() => exit(), 40);
      return () => clearTimeout(t);
    }
    if (phase === "done") {
      const cmd = props.startCommand(answers as Answers);
      setStartCmd(cmd);
      if (!cmd) {
        props.onFinish(null);
        const t = setTimeout(() => exit(), 40);
        return () => clearTimeout(t);
      }
    }
  }, [phase, exit, props, answers]);

  function submit(value: string) {
    if (!currentKey) return;
    const next = { ...answers, [currentKey]: value };
    setAnswers(next);
    if (idx + 1 < askSteps.length) setIdx(idx + 1);
    else setPhase("scaffolding");
  }

  const answered = STEP_ORDER.filter((k) => k !== currentKey && answers[k] != null);

  return (
    <ThemeProvider theme={uiTheme}>
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Banner />

        {phase === "form" && currentKey ? (
          <Panel>
            <Box justifyContent="space-between">
              <Text bold color={C.white}>
                Let's build on Avalanche
              </Text>
              <Text
                color={C.dim}
              >{`create-avalanche-app v${props.version}  ·  step ${idx + 1}/${askSteps.length}`}</Text>
            </Box>

            {answered.length > 0 ? (
              <Box marginTop={1} flexDirection="column">
                {answered.map((k) => (
                  <Text key={k}>
                    <Text color={C.crimson}>✓ </Text>
                    <Text color={C.dim}>{`${LABELS[k]}  `}</Text>
                    <Text color={C.white}>
                      {displayValue(props.templates, k, answers[k] as string)}
                    </Text>
                  </Text>
                ))}
              </Box>
            ) : null}

            <Box marginTop={1} flexDirection="column">
              <Text bold color={C.crimsonBright}>
                {LABELS[currentKey]}
              </Text>
              <Box marginTop={0}>
                {currentKey === "projectName" ? (
                  <TextInput
                    placeholder="my-avax-app"
                    defaultValue={(answers.projectName as string) ?? ""}
                    onSubmit={(v) => {
                      const val = v.trim() || "my-avax-app";
                      if (!NAME_RE.test(val)) {
                        setNameError("Use lowercase letters, digits, and - . _");
                        return;
                      }
                      setNameError(null);
                      submit(val);
                    }}
                  />
                ) : (
                  <Select
                    options={optionsFor(currentKey, props.templates)}
                    onChange={(v) => submit(v)}
                  />
                )}
              </Box>
              {nameError && currentKey === "projectName" ? (
                <Text color={C.crimson}>{nameError}</Text>
              ) : (
                <Text color={C.dim}>
                  {currentKey === "projectName" ? "lowercase, e.g. my-avax-app" : HINT}
                </Text>
              )}
            </Box>
          </Panel>
        ) : null}

        {phase !== "form" ? (
          <Panel>
            <Box flexDirection="column">
              {STEP_ORDER.filter((k) => answers[k] != null).map((k) => (
                <Text key={k}>
                  <Text color={C.dim}>{`${LABELS[k].padEnd(16)}`}</Text>
                  <Text color={C.white}>
                    {displayValue(props.templates, k, answers[k] as string)}
                  </Text>
                </Text>
              ))}
            </Box>

            <Box marginTop={1} flexDirection="column">
              {scaffoldState === "running" ? (
                <Spinner label="Scaffolding project" />
              ) : (
                <Text color={C.green}>{`✓ Created ${created} files`}</Text>
              )}
              {props.install ? (
                installState === "running" ? (
                  <Spinner label="Installing dependencies" />
                ) : installState === "done" ? (
                  <Text color={C.green}>✓ Dependencies installed</Text>
                ) : installState === "warn" ? (
                  <Text color={C.yellow}>! Install skipped — run it manually</Text>
                ) : (
                  <Text color={C.dim}>· Installing dependencies</Text>
                )
              ) : null}
            </Box>

            {phase === "done" ? (
              <Box marginTop={1} flexDirection="column">
                <Text bold color={C.green}>
                  Your Avalanche dapp is ready.
                </Text>
                <Box marginTop={1} flexDirection="column">
                  <Text color={C.dim}>Next steps</Text>
                  {props.nextSteps(answers as Answers).map((s) => (
                    <Text key={s} color={C.crimsonBright}>{`  ${s}`}</Text>
                  ))}
                </Box>
                <Box marginTop={1}>
                  <Text color={C.dim}>Docs → </Text>
                  <Text color={C.crimson}>avakit.dev/docs</Text>
                </Box>
                {startCmd ? (
                  <Box marginTop={1}>
                    <Text color={C.crimsonBright}>{`${startCmd.label} `}</Text>
                    <ConfirmInput
                      onConfirm={() => {
                        props.onFinish(startCmd);
                        exit();
                      }}
                      onCancel={() => {
                        props.onFinish(null);
                        exit();
                      }}
                    />
                  </Box>
                ) : null}
              </Box>
            ) : null}

            {phase === "error" ? (
              <Box marginTop={1}>
                <Text color={C.crimson}>{`✗ ${error}`}</Text>
              </Box>
            ) : null}
          </Panel>
        ) : null}
      </Box>
    </ThemeProvider>
  );
}

/** Render the interactive wizard and resolve when it exits. */
export async function runWizard(props: WizardProps): Promise<void> {
  const instance = render(<App {...props} />);
  await instance.waitUntilExit();
}
