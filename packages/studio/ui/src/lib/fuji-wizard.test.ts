import { describe, expect, it } from "vitest";
import * as serverRules from "../../../src/validators";
import {
  canEditFujiField,
  checkFujiForm,
  type FujiForm,
  type FujiStep,
  type FujiWizardAction,
  type FujiWizardState,
  fujiFormProblems,
  fujiWizardReducer,
  initialFujiWizard,
  stepForRun,
} from "./fuji-wizard";
import type { RunInfo } from "./run-store";
import * as wizardRules from "./validators";

const ADDRESS_A = "0x00000000000000000000000000000000000000aa";
const ADDRESS_B = "0x00000000000000000000000000000000000000bb";

function reduce(state: FujiWizardState, ...actions: FujiWizardAction[]): FujiWizardState {
  return actions.reduce(fujiWizardReducer, state);
}

function fujiRun(patch: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 1,
    kind: "fuji",
    action: "transfer",
    params: { name: "myfujil1", chainId: "77777", symbol: "FUJ", amount: "0.3" },
    status: "running",
    exitCode: null,
    cancelled: false,
    startedAt: 1,
    finishedAt: null,
    ...patch,
  };
}
const done = (patch: Partial<RunInfo> = {}) =>
  fujiRun({ status: "done", exitCode: 0, finishedAt: 2, ...patch });

/** Key created and funded for the default name. */
const funded = reduce(
  initialFujiWizard,
  { type: "key", name: "myfujil1", address: ADDRESS_A },
  {
    type: "balance",
    name: "myfujil1",
    balance: { address: ADDRESS_A, cBalance: "2.0000", error: null },
  },
);

describe("Fuji wizard: the key always belongs to the current name", () => {
  it("shows the address of the key that was created", () => {
    expect(funded).toMatchObject({ address: ADDRESS_A, cBalance: "2.0000", step: "fund" });
  });

  it("forgets the address and balance when the name changes", () => {
    const renamed = reduce(funded, { type: "edit", field: "name", value: "other" });
    expect(renamed.form.name).toBe("other");
    expect(renamed.address).toBeNull();
    expect(renamed.cBalance).toBe("0");
    // Not funded any more: the wizard cannot move on with the old key's balance.
    expect(reduce(renamed, { type: "funded" }).step).toBe("fund");
  });

  it("keeps them when another field changes, or the name is retyped unchanged", () => {
    const edited = reduce(
      funded,
      { type: "edit", field: "chainId", value: "88888" },
      { type: "edit", field: "token", value: "ABC" },
      { type: "edit", field: "amount", value: "0.5" },
      { type: "edit", field: "name", value: "myfujil1" },
    );
    expect(edited).toMatchObject({
      address: ADDRESS_A,
      cBalance: "2.0000",
      form: { name: "myfujil1", chainId: "88888", token: "ABC", amount: "0.5" },
    });
  });

  it("ignores a key or balance answer that belongs to a name typed earlier", () => {
    // "Create key" was clicked for myfujil1, then the name was changed before it answered.
    const renamed = reduce(initialFujiWizard, { type: "edit", field: "name", value: "other" });
    const late = reduce(
      renamed,
      { type: "key", name: "myfujil1", address: ADDRESS_A },
      {
        type: "balance",
        name: "myfujil1",
        balance: { address: ADDRESS_A, cBalance: "2.0000", error: null },
      },
    );
    expect(late).toEqual(renamed);
  });

  it("ignores a balance for an address other than the one on screen", () => {
    const next = reduce(funded, {
      type: "balance",
      name: "myfujil1",
      balance: { address: ADDRESS_B, cBalance: "9.0000", error: null },
    });
    expect(next.cBalance).toBe("2.0000");
  });

  it("keeps the last known balance when a reading fails, and says why", () => {
    const failed = reduce(funded, {
      type: "balance",
      name: "myfujil1",
      balance: { address: ADDRESS_A, cBalance: "0", error: "could not reach the Fuji RPC" },
    });
    expect(failed).toMatchObject({
      cBalance: "2.0000",
      balanceError: "could not reach the Fuji RPC",
    });
    const recovered = reduce(failed, {
      type: "balance",
      name: "myfujil1",
      balance: { address: ADDRESS_A, cBalance: "2.5000", error: null },
    });
    expect(recovered).toMatchObject({ cBalance: "2.5000", balanceError: null });
  });

  it("fixes the name (the key's name) once funding is done", () => {
    const moved = reduce(funded, { type: "funded" });
    expect(moved.step).toBe("transfer");
    expect(reduce(moved, { type: "edit", field: "name", value: "other" })).toEqual(moved);
  });

  it("does not move past funding without a key", () => {
    expect(reduce(initialFujiWizard, { type: "funded" }).step).toBe("fund");
  });
});

describe("Fuji wizard: a configuration the server would refuse", () => {
  const edit = (field: keyof FujiForm, value: string): FujiWizardAction => ({
    type: "edit",
    field,
    value,
  });

  it("applies the server's own rules, not a copy of them", () => {
    // The functions the server validates a request with (src/validators.ts;
    // the server's side of this is checked in src/fuji.test.ts) …
    expect(wizardRules.isValidL1Name).toBe(serverRules.isValidL1Name);
    expect(wizardRules.isValidChainId).toBe(serverRules.isValidChainId);
    expect(wizardRules.isValidToken).toBe(serverRules.isValidToken);
    expect(wizardRules.isValidAmount).toBe(serverRules.isValidAmount);

    // … so the wizard refuses exactly what the deploy or the transfer would.
    const form = initialFujiWizard.form;
    expect(checkFujiForm(form)).toEqual({
      name: true,
      chainId: true,
      token: true,
      amount: true,
      ok: true,
    });
    expect(checkFujiForm({ ...form, chainId: "0123" })).toMatchObject({
      chainId: false,
      ok: false,
    });
    expect(checkFujiForm({ ...form, token: "TOOLONGTOKEN" })).toMatchObject({
      token: false,
      ok: false,
    });
    expect(checkFujiForm({ ...form, name: "My-L1" })).toMatchObject({ name: false, ok: false });
    // More than the server lets through in one transfer (the page used to accept it).
    expect(checkFujiForm({ ...form, amount: "1001" })).toMatchObject({ amount: false, ok: false });
    expect(checkFujiForm({ ...form, amount: "" })).toMatchObject({ amount: false, ok: false });
  });

  it("names the rule behind each refused value", () => {
    expect(fujiFormProblems(initialFujiWizard.form)).toEqual([]);
    const problems = fujiFormProblems({
      name: "myfujil1",
      chainId: "0123",
      token: "TOOLONGTOKEN",
      amount: "0.3",
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^chain ID: /);
    expect(problems[1]).toMatch(/^token: /);
  });

  it("does not move past funding — towards the transfer — with an invalid chain ID, token or amount", () => {
    for (const [field, value] of [
      ["chainId", "0123"],
      ["token", "TOOLONGTOKEN"],
      ["amount", "1001"],
    ] as const) {
      const invalid = reduce(funded, edit(field, value));
      expect(reduce(invalid, { type: "funded" }).step, field).toBe("fund");
      // Corrected, it moves on.
      const fixed = reduce(invalid, edit(field, initialFujiWizard.form[field]));
      expect(reduce(fixed, { type: "funded" }).step, field).toBe("transfer");
    }
  });

  it("keeps a value editable until the action that uses it has run", () => {
    const editable = (step: FujiStep) =>
      (["name", "amount", "chainId", "token"] as const).filter((f) => canEditFujiField(step, f));
    expect(editable("fund")).toEqual(["name", "amount", "chainId", "token"]);
    expect(editable("transfer")).toEqual(["amount", "chainId", "token"]);
    expect(editable("deploy")).toEqual(["chainId", "token"]);
    expect(editable("live")).toEqual([]);
  });

  it("lets a refused deploy be corrected on the deploy step, without starting over", () => {
    // Funded, transferred: on the deploy step, where the server refuses the request.
    const atDeploy = reduce(funded, { type: "funded" }, { type: "run", run: done() });
    expect(atDeploy.step).toBe("deploy");

    const corrected = reduce(atDeploy, edit("chainId", "4242"), edit("token", "NEW"));
    expect(corrected).toMatchObject({
      step: "deploy",
      form: { name: "myfujil1", chainId: "4242", token: "NEW", amount: "0.3" },
      // Still the same funded key: nothing to fund or transfer again.
      address: ADDRESS_A,
    });
    // What the transfer already used is history.
    expect(reduce(corrected, edit("amount", "9"), edit("name", "other"))).toEqual(corrected);

    // Once the L1 is live, nothing is.
    const live = reduce(corrected, { type: "run", run: done({ id: 2, action: "deploy" }) });
    expect(live.step).toBe("live");
    expect(reduce(live, edit("chainId", "1"), edit("token", "X"))).toEqual(live);
  });
});

describe("Fuji wizard: following the server's runs", () => {
  it("maps a run to the step it belongs to", () => {
    expect(stepForRun(fujiRun({ action: "transfer" }))).toBe("transfer");
    expect(stepForRun(done({ action: "transfer" }))).toBe("deploy");
    expect(stepForRun(fujiRun({ action: "deploy" }))).toBe("deploy");
    expect(stepForRun(done({ action: "deploy" }))).toBe("live");
    // A failed or cancelled step is the one to retry.
    expect(stepForRun(done({ action: "transfer", exitCode: 1 }))).toBe("transfer");
    expect(stepForRun(done({ action: "deploy", exitCode: 1 }))).toBe("deploy");
    expect(stepForRun(done({ action: "deploy", cancelled: true }))).toBe("deploy");
  });

  it("walks transfer → deploy → live as the runs succeed", () => {
    const transferring = reduce(funded, { type: "funded" }, { type: "run", run: fujiRun() });
    expect(transferring.step).toBe("transfer");
    const transferred = reduce(transferring, { type: "run", run: done() });
    expect(transferred.step).toBe("deploy");
    const deploying = reduce(transferred, {
      type: "run",
      run: fujiRun({ id: 2, action: "deploy" }),
    });
    expect(deploying.step).toBe("deploy");
    expect(reduce(deploying, { type: "run", run: done({ id: 2, action: "deploy" }) }).step).toBe(
      "live",
    );
  });

  it("restores the step and the form after a reload in the middle of a deploy", () => {
    // A fresh wizard (defaults) meets a deploy that is still running on the server.
    const restored = reduce(initialFujiWizard, {
      type: "run",
      run: fujiRun({
        action: "deploy",
        params: { name: "prodl1", chainId: "4242", symbol: "PRD", amount: "0.7" },
      }),
    });
    expect(restored.step).toBe("deploy");
    expect(restored.form).toEqual({ name: "prodl1", chainId: "4242", token: "PRD", amount: "0.7" });
  });

  it("restores a run that ended while the tab was closed", () => {
    const params = { name: "prodl1", chainId: "4242", symbol: "PRD" };
    expect(
      reduce(initialFujiWizard, { type: "run", run: done({ action: "deploy", params }) }),
    ).toMatchObject({ step: "live", form: { name: "prodl1" } });
    expect(
      reduce(initialFujiWizard, {
        type: "run",
        run: done({ action: "deploy", params, exitCode: 1 }),
      }).step,
    ).toBe("deploy");
  });

  it("keeps form values the run does not carry", () => {
    const state = reduce(
      initialFujiWizard,
      { type: "edit", field: "chainId", value: "4242" },
      { type: "run", run: fujiRun({ params: { name: "myfujil1", amount: "0.9" } }) },
    );
    expect(state.form).toEqual({ name: "myfujil1", chainId: "4242", token: "FUJ", amount: "0.9" });
  });

  it("drops another L1's key and details when a run for a different L1 takes over", () => {
    const state = reduce(funded, {
      type: "run",
      run: fujiRun({ params: { name: "other", amount: "0.3" } }),
    });
    expect(state).toMatchObject({ form: { name: "other" }, address: null, cBalance: "0" });
  });

  it("ignores devnet runs", () => {
    const moved = reduce(funded, { type: "funded" });
    const devnet = { ...fujiRun(), kind: "devnet" as const, action: "create-icm", params: {} };
    expect(reduce(moved, { type: "run", run: devnet })).toEqual(moved);
  });

  it("applying the same run twice changes nothing", () => {
    const once = reduce(funded, { type: "run", run: done() });
    expect(reduce(once, { type: "run", run: done() })).toEqual(once);
  });

  it("records the deployed L1 for the current name only, and forgets it on a retry", () => {
    const live = reduce(funded, { type: "run", run: done({ action: "deploy" }) });
    const l1 = {
      deployed: true,
      rpcUrl: "http://127.0.0.1:9650/ext/bc/x/rpc",
      blockchainId: "x",
      evmChainId: 77777,
      running: true,
    };
    expect(reduce(live, { type: "l1", name: "other", l1 }).l1).toBeNull();
    const known = reduce(live, { type: "l1", name: "myfujil1", l1 });
    expect(known.l1).toEqual(l1);
    // Re-applying the finished deploy keeps it …
    expect(reduce(known, { type: "run", run: done({ action: "deploy" }) }).l1).toEqual(l1);
    // … a new deploy starts from scratch.
    expect(reduce(known, { type: "run", run: fujiRun({ id: 2, action: "deploy" }) }).l1).toBeNull();
  });

  it("reset starts over on the same configuration", () => {
    const live = reduce(
      funded,
      { type: "edit", field: "chainId", value: "4242" },
      { type: "run", run: done({ action: "deploy", params: { name: "myfujil1" } }) },
    );
    expect(reduce(live, { type: "reset" })).toEqual({
      ...initialFujiWizard,
      form: { ...initialFujiWizard.form, chainId: "4242" },
    });
  });
});
