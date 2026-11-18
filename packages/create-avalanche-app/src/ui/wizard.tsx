import { ConfirmInput, Select, Spinner, TextInput, ThemeProvider } from "@inkjs/ui";
import { Box, type RenderOptions, render, Text, useApp } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { PackageManager } from "../pm.js";
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
  chain: string;
  pm: string;
};
export type TemplateInfo = { id: string; title: string; description: string };

/** A command to optionally run for the user once scaffolding finishes. */
export type StartCommand = { pm: PackageManager; args: string[]; cwd: string; label: string };

/** How the dependency install went; `reason` and `output` explain a failure. */
export type InstallOutcome = { ok: boolean; reason: string; output: string };

export type WizardProps = {
  version: string;
  templates: TemplateInfo[];
  /** The package managers to offer, in display order (the first is the default). */
  packageManagers: string[];
  /** The manager the CLI was launched with, if known — labelled in the list. */
  detectedPackageManager: string | null;
  presets: Partial<Answers>;
  /**
   * Why a typed project name cannot be used, or null when it can. The same rule
   * the scaffolder applies, so a name accepted here never fails afterwards.
   */
  validateName: (name: string) => string | null;
  scaffold: (a: Answers) => Promise<{ created: number }>;
  /** Installs the dependencies, or null when the user passed --no-install. */
  install: ((a: Answers) => Promise<InstallOutcome>) | null;
  /** `installed` is false when the install was skipped or failed. */
  nextSteps: (a: Answers, installed: boolean) => string[];
  /** If it returns a command, the wizard offers to run it (e.g. the dev server). */
  startCommand: (a: Answers, installed: boolean) => StartCommand | null;
};

export type WizardResult = {
  /**
   * `created`: the app was scaffolded (its install may still have failed).
   * `failed`: scaffolding itself failed. `cancelled`: the user backed out.
   */
  outcome: "created" | "failed" | "cancelled";
  /** The command the user chose to run next, or null. */
  start: StartCommand | null;
};

type AppProps = WizardProps & {
  /** Called once, just before the wizard exits. */
  onFinish: (result: WizardResult) => void;
};

type StepKey = keyof Answers;
const STEP_ORDER: StepKey[] = ["projectName", "template", "chain", "pm"];
const LABELS: Record<StepKey, string> = {
  projectName: "Project name",
  template: "Template",
  chain: "Network",
  pm: "Package manager",
};
const HINT = "↑/↓ to navigate · Enter to confirm";

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
  if (key === "chain") return value === "c-chain" ? "C-Chain (mainnet)" : "Fuji testnet";
  return value;
}

function optionsFor(key: StepKey, props: WizardProps): { label: string; value: string }[] {
  switch (key) {
    case "template":
      return props.templates.map((t) => ({ label: t.title, value: t.id }));
    case "chain":
      return [
        { label: "Fuji testnet  ·  recommended", value: "fuji" },
        { label: "C-Chain (mainnet)", value: "c-chain" },
      ];
    case "pm":
      return props.packageManagers.map((m) => ({
        label: m === props.detectedPackageManager ? `${m}  ·  detected` : m,
        value: m,
      }));
    default:
      return [];
  }
}

// ── The wizard ──────────────────────────────────────────────────────────────
function App(props: AppProps) {
  const { exit } = useApp();
  const askSteps = useMemo(() => STEP_ORDER.filter((k) => !props.presets[k]), [props.presets]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Partial<Answers>>({ ...props.presets });
  const [phase, setPhase] = useState<"form" | "confirm" | "scaffolding" | "done" | "error">(
    askSteps.length ? "form" : "scaffolding",
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [created, setCreated] = useState(0);
  const [scaffoldState, setScaffoldState] = useState<"running" | "done">("running");
  const [installState, setInstallState] = useState<"pending" | "running" | "done" | "failed">(
    "pending",
  );
  const [installProblem, setInstallProblem] = useState<InstallOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startCmd, setStartCmd] = useState<StartCommand | null>(null);

  const currentKey = askSteps[idx];
  // Only a finished, successful install counts: the next steps and the
  // dev-server offer must not assume dependencies that are not there.
  const installed = props.install !== null && installState === "done";

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
          const outcome = await props.install(answers as Answers);
          if (!alive) return;
          setInstallProblem(outcome.ok ? null : outcome);
          setInstallState(outcome.ok ? "done" : "failed");
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
      props.onFinish({ outcome: "failed", start: null });
      const t = setTimeout(() => exit(), 40);
      return () => clearTimeout(t);
    }
    if (phase === "done") {
      const cmd = props.startCommand(answers as Answers, installed);
      setStartCmd(cmd);
      if (!cmd) {
        props.onFinish({ outcome: "created", start: null });
        const t = setTimeout(() => exit(), 40);
        return () => clearTimeout(t);
      }
    }
  }, [phase, exit, props, answers, installed]);

  function submit(value: string) {
    if (!currentKey) return;
    const next = { ...answers, [currentKey]: value };
    setAnswers(next);
    if (idx + 1 < askSteps.length) setIdx(idx + 1);
    else setPhase("confirm");
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
                      const problem = props.validateName(val);
                      if (problem) {
                        setNameError(problem);
                        return;
                      }
                      setNameError(null);
                      submit(val);
                    }}
                  />
                ) : (
                  <Select options={optionsFor(currentKey, props)} onChange={(v) => submit(v)} />
                )}
              </Box>
              {nameError && currentKey === "projectName" ? (
                <Text color={C.crimson}>{nameError}</Text>
              ) : (
                <Text color={C.dim}>
                  {currentKey === "projectName"
                    ? "letters, digits, and . _ -  ·  e.g. my-avax-app"
                    : HINT}
                </Text>
              )}
            </Box>
          </Panel>
        ) : null}

        {phase === "confirm" ? (
          <Panel>
            <Text bold color={C.white}>
              Review
            </Text>
            <Box marginTop={1} flexDirection="column">
              {STEP_ORDER.filter((k) => answers[k] != null).map((k) => (
                <Text key={k}>
                  <Text color={C.dim}>{`${LABELS[k].padEnd(16)}`}</Text>
                  <Text color={C.white}>
                    {displayValue(props.templates, k, answers[k] as string)}
                  </Text>
                </Text>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color={C.crimsonBright}>Create the app now? </Text>
              <ConfirmInput
                onConfirm={() => setPhase("scaffolding")}
                onCancel={() => {
                  props.onFinish({ outcome: "cancelled", start: null });
                  exit();
                }}
              />
            </Box>
          </Panel>
        ) : null}

        {phase === "scaffolding" || phase === "done" || phase === "error" ? (
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
                  <Spinner label={`Installing dependencies with ${answers.pm}`} />
                ) : installState === "done" ? (
                  <Text color={C.green}>✓ Dependencies installed</Text>
                ) : installState === "failed" ? (
                  <Box flexDirection="column">
                    <Text color={C.yellow}>
                      {`! Dependencies were not installed: ${installProblem?.reason ?? "the install failed"}`}
                    </Text>
                    {installProblem?.output ? (
                      <Text color={C.dim}>{installProblem.output}</Text>
                    ) : null}
                  </Box>
                ) : (
                  <Text color={C.dim}>· Installing dependencies</Text>
                )
              ) : null}
            </Box>

            {phase === "done" ? (
              <Box marginTop={1} flexDirection="column">
                {installState === "failed" ? (
                  <Text bold color={C.yellow}>
                    Your Avalanche dapp was created, but its dependencies are not installed.
                  </Text>
                ) : (
                  <Text bold color={C.green}>
                    Your Avalanche dapp is ready.
                  </Text>
                )}
                <Box marginTop={1} flexDirection="column">
                  <Text color={C.dim}>Next steps</Text>
                  {props.nextSteps(answers as Answers, installed).map((s) => (
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
                        props.onFinish({ outcome: "created", start: startCmd });
                        exit();
                      }}
                      onCancel={() => {
                        props.onFinish({ outcome: "created", start: null });
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

/**
 * Render the interactive wizard and resolve with how it ended once it exits.
 * Leaving without finishing (Ctrl+C) counts as cancelled.
 *
 * @param renderOptions Ink render options; tests pass fake streams here.
 */
export async function runWizard(
  props: WizardProps,
  renderOptions?: RenderOptions,
): Promise<WizardResult> {
  let result: WizardResult = { outcome: "cancelled", start: null };
  const instance = render(
    <App
      {...props}
      onFinish={(finished) => {
        result = finished;
      }}
    />,
    renderOptions,
  );
  await instance.waitUntilExit();
  return result;
}
