import { describe, expect, it } from "vitest";
import { type CliOptions, parseArgs, UsageError } from "./args.js";

const TEMPLATES = [
  { id: "minimal", chains: ["fuji" as const, "c-chain" as const] },
  { id: "nft-mint", chains: ["fuji" as const] },
  { id: "icm-messenger", chains: ["fuji" as const] },
];

function options(...args: string[]): CliOptions {
  const parsed = parseArgs(args, TEMPLATES);
  if (parsed.command !== "create") throw new Error(`expected a create command for ${args}`);
  return parsed.options;
}

function usageError(...args: string[]): string {
  try {
    parseArgs(args, TEMPLATES);
  } catch (error) {
    expect(error, args.join(" ")).toBeInstanceOf(UsageError);
    return (error as Error).message;
  }
  throw new Error(`expected a usage error for: ${args.join(" ")}`);
}

describe("parseArgs", () => {
  it("defaults to an interactive run that installs", () => {
    expect(options()).toEqual({ yes: false, local: false, install: true });
  });

  it("reads every option, in short and long form", () => {
    expect(
      options(
        "my-app",
        "-t",
        "minimal",
        "-c",
        "c-chain",
        "--pm",
        "yarn",
        "-y",
        "--no-install",
        "--local",
        "--no-telemetry",
      ),
    ).toEqual({
      projectName: "my-app",
      template: "minimal",
      chain: "c-chain",
      pm: "yarn",
      yes: true,
      local: true,
      install: false,
      telemetry: false,
    });
    expect(options("--template", "minimal", "--chain", "fuji", "--yes", "--telemetry")).toEqual({
      template: "minimal",
      chain: "fuji",
      yes: true,
      local: false,
      install: true,
      telemetry: true,
    });
  });

  it("accepts --flag=value", () => {
    expect(options("--template=nft-mint", "--chain=fuji", "--pm=bun")).toMatchObject({
      template: "nft-mint",
      chain: "fuji",
      pm: "bun",
    });
  });

  it("lets the last occurrence of a flag win", () => {
    expect(options("-t", "minimal", "-t", "nft-mint").template).toBe("nft-mint");
  });

  it("ignores a bare -- separator", () => {
    expect(options("my-app", "--", "--template", "nft-mint", "--yes")).toMatchObject({
      projectName: "my-app",
      template: "nft-mint",
      yes: true,
    });
  });

  it("returns help or version wherever the flag appears", () => {
    expect(parseArgs(["--help"], TEMPLATES)).toEqual({ command: "help" });
    expect(parseArgs(["my-app", "-h"], TEMPLATES)).toEqual({ command: "help" });
    expect(parseArgs(["--tempalte", "x", "--help"], TEMPLATES)).toEqual({ command: "help" });
    expect(parseArgs(["-v"], TEMPLATES)).toEqual({ command: "version" });
    expect(parseArgs(["--version", "--bogus"], TEMPLATES)).toEqual({ command: "version" });
  });

  it("rejects an unknown option instead of ignoring it", () => {
    expect(usageError("my-app", "--tempalte", "nft-mint")).toBe('Unknown option "--tempalte".');
    expect(usageError("-x")).toBe('Unknown option "-x".');
    expect(usageError("--template-id=minimal")).toBe('Unknown option "--template-id=minimal".');
  });

  it("rejects an unknown template and lists the valid ones", () => {
    // This used to scaffold `minimal` and exit 0.
    expect(usageError("--template", "nft")).toBe(
      'Unknown template "nft". Valid templates: minimal, nft-mint, icm-messenger.',
    );
    expect(usageError("--template=")).toContain('Unknown template "".');
  });

  it("rejects an unknown chain and lists the valid ones", () => {
    // This used to scaffold for Fuji and exit 0.
    expect(usageError("--chain", "mainnet")).toBe(
      'Unknown chain "mainnet". Valid chains: fuji, c-chain.',
    );
    expect(usageError("-c", "C-Chain")).toContain("Valid chains: fuji, c-chain.");
  });

  it("rejects a chain the chosen template does not support, naming the ones it does", () => {
    expect(usageError("--template", "nft-mint", "--chain", "c-chain")).toBe(
      'Template "nft-mint" cannot be scaffolded for chain "c-chain". It supports: fuji.',
    );
    // The order of the flags does not matter.
    expect(usageError("-c", "c-chain", "-t", "icm-messenger")).toContain("It supports: fuji.");
  });

  it("accepts every template with the chains it lists", () => {
    expect(options("-t", "minimal", "-c", "c-chain")).toMatchObject({
      template: "minimal",
      chain: "c-chain",
    });
    for (const template of ["minimal", "nft-mint", "icm-messenger"]) {
      expect(options("-t", template, "-c", "fuji")).toMatchObject({ template, chain: "fuji" });
      expect(options("-t", template).chain).toBeUndefined();
    }
    // A chain alone is fine as long as some template runs on it.
    expect(options("-c", "c-chain")).toMatchObject({ chain: "c-chain" });
  });

  it("rejects a chain that no template supports", () => {
    const fujiOnly = [{ id: "nft-mint", chains: ["fuji" as const] }];
    expect(() => parseArgs(["--chain", "c-chain"], fujiOnly)).toThrow(
      'No template can be scaffolded for chain "c-chain".',
    );
  });

  it("rejects an unknown package manager and lists the valid ones", () => {
    expect(usageError("--pm", "/Users/alice/.local/share/pnpm/pnpm")).toBe(
      'Unknown package manager "/Users/alice/.local/share/pnpm/pnpm". Valid package managers: pnpm, npm, yarn, bun.',
    );
    expect(usageError("--pm=npx")).toContain("Valid package managers: pnpm, npm, yarn, bun.");
  });

  it("reports a flag whose value is missing, rather than eating the next flag", () => {
    expect(usageError("--template")).toBe(
      "Option --template needs a value: minimal, nft-mint, icm-messenger.",
    );
    expect(usageError("-c", "--yes")).toBe("Option -c needs a value: fuji, c-chain.");
    expect(usageError("my-app", "--pm")).toBe("Option --pm needs a value: pnpm, npm, yarn, bun.");
  });

  it("rejects a value on a flag that takes none", () => {
    expect(usageError("--yes=true")).toBe("Option --yes does not take a value.");
    expect(usageError("--no-install=1")).toBe("Option --no-install does not take a value.");
  });

  it("rejects a second positional argument", () => {
    expect(usageError("my", "app")).toBe(
      'Unexpected argument "app": the project name is already "my".',
    );
  });

  it("applies the scaffolder's project-name rule up front", () => {
    for (const name of ["../evil", "my-app-", "app.", ".env", "a/b", "a".repeat(65)]) {
      expect(usageError(name), name).toContain("Invalid project name");
    }
    for (const name of ["my-avax-app", "App123", "app.v2", "my_app"]) {
      expect(options(name).projectName).toBe(name);
    }
  });

  it("treats words that are also object properties as plain names", () => {
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(options(name)).toEqual({ projectName: name, yes: false, local: false, install: true });
    }
  });

  it("still accepts the removed --wallet flag and its value", () => {
    expect(options("-w", "injected", "my-app").projectName).toBe("my-app");
    expect(options("--wallet", "web3auth", "--yes")).toMatchObject({ yes: true });
    expect(options("--wallet=burner", "my-app").projectName).toBe("my-app");
    // With no value to consume it must not swallow the flag after it.
    expect(options("-w", "--yes")).toMatchObject({ yes: true });
    expect(options("-w")).toEqual({ yes: false, local: false, install: true });
  });
});
