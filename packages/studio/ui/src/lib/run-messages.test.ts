import { describe, expect, it } from "vitest";
import {
  cancelWarning,
  consoleLines,
  finishNotice,
  runHome,
  runLabel,
  startFailureNotice,
} from "./run-messages";
import { RunBusyError, type RunInfo } from "./run-store";

function run(patch: Partial<RunInfo>): RunInfo {
  return {
    id: 1,
    kind: "devnet",
    action: "create-icm",
    params: {},
    status: "done",
    exitCode: 0,
    cancelled: false,
    startedAt: 1,
    finishedAt: 2,
    ...patch,
  };
}

describe("run messages", () => {
  it("names every action the dashboard can start", () => {
    expect(runLabel({ kind: "devnet", action: "create-icm" })).toBe("Spin up ICM devnet");
    expect(runLabel({ kind: "devnet", action: "create-l1" })).toBe("Launch L1");
    expect(runLabel({ kind: "devnet", action: "start" })).toBe("Start network");
    expect(runLabel({ kind: "devnet", action: "stop" })).toBe("Stop network");
    expect(runLabel({ kind: "fuji", action: "transfer" })).toBe("C→P transfer");
    expect(runLabel({ kind: "fuji", action: "deploy" })).toBe("Deploy to Fuji");
    expect(runLabel({ kind: "devnet", action: "something-new" })).toBe("devnet something-new");
  });

  it("knows which view shows a run's console", () => {
    expect(runHome({ kind: "devnet" })).toBe("devnet");
    expect(runHome({ kind: "fuji" })).toBe("fuji");
  });

  it("announces success per action", () => {
    expect(finishNotice(run({ action: "create-icm" }))).toMatchObject({
      title: "Devnet is ready",
      variant: "success",
    });
    expect(finishNotice(run({ kind: "fuji", action: "transfer" }))).toMatchObject({
      title: "Funds on the P-Chain",
      variant: "success",
    });
    expect(finishNotice(run({ action: "something-new" }))).toMatchObject({
      title: "Done",
      variant: "success",
    });
  });

  it("reports a failure as an error and points at the right console", () => {
    expect(finishNotice(run({ exitCode: 1 }))).toMatchObject({
      title: "Something went wrong",
      variant: "error",
      description: expect.stringContaining("console in Devnet"),
    });
    expect(finishNotice(run({ kind: "fuji", action: "deploy", exitCode: 1 }))).toMatchObject({
      title: "Step failed",
      variant: "error",
      description: expect.stringContaining("console in Launch on Fuji"),
    });
  });

  it("frames the console: the action first, a closing line only on success", () => {
    const log = ["$ avalanche network stop", "Network stopped successfully."];
    expect(consoleLines(run({ action: "stop", status: "running", exitCode: null }), log)).toEqual([
      "▸ stop",
      ...log,
    ]);
    expect(consoleLines(run({ action: "stop" }), log)).toEqual(["▸ stop", ...log, "✔ done"]);
    // The runner already ended these with its own line.
    const failed = ["$ avalanche network stop", "✖ exited with code 1"];
    expect(consoleLines(run({ action: "stop", exitCode: 1 }), failed)).toEqual([
      "▸ stop",
      ...failed,
    ]);
    const cancelled = ["$ avalanche network start", "■ cancelled"];
    expect(
      consoleLines(run({ action: "start", exitCode: 143, cancelled: true }), cancelled),
    ).toEqual(["▸ start", ...cancelled]);
  });

  it("explains a refused start by naming the action in the way", () => {
    const busy = new RunBusyError(run({ status: "running", exitCode: null }), "busy");
    expect(startFailureNotice(busy)).toEqual({
      title: "Another action is running",
      description: "“Spin up ICM devnet” has not finished yet — its output is shown in Devnet.",
      variant: "info",
    });
    // An action of another Studio process has no console here: the server's words stand.
    const elsewhere =
      "Another action (devnet start) is still running in another Studio process (pid 4242) — wait for it to finish, then retry.";
    expect(startFailureNotice(new RunBusyError(null, elsewhere))).toEqual({
      title: "Another action is running",
      description: elsewhere,
      variant: "info",
    });
    expect(startFailureNotice(new Error("invalid L1"))).toEqual({
      title: "Could not start",
      description: "invalid L1",
      variant: "error",
    });
  });

  it("warns about what cancelling can leave behind", () => {
    expect(cancelWarning({ kind: "fuji", action: "deploy" })).toMatch(
      /^Stop “Deploy to Fuji”\? .*half-created/,
    );
    expect(cancelWarning({ kind: "devnet", action: "create-icm" })).toMatch(
      /^Stop “Spin up ICM devnet”\? .*half set up/,
    );
  });

  it("does not call a cancelled run a success or a failure", () => {
    expect(finishNotice(run({ cancelled: true, exitCode: 143 }))).toMatchObject({
      title: "Action cancelled",
      variant: "info",
    });
    // Even if the process happened to exit cleanly while being stopped.
    expect(finishNotice(run({ cancelled: true, exitCode: 0 })).variant).toBe("info");
  });
});
