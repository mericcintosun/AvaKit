import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther } from "viem";
import {
  DEFAULT_DAILY_DRIPS,
  DEFAULT_DAILY_DRIPS_VERIFIED,
  dailyBudgets,
  deployedVersion,
  dripAmount,
  isPaused,
  lowBalance,
  tokenRequired,
  turnstileOrigins,
} from "../src/config.js";
import { FaucetConfigError } from "../src/sender.js";

/** Asserts that `read` refuses the setting with `message`, and never repeats `value`. */
function refuses(read, message, value) {
  assert.throws(read, (e) => {
    assert.ok(e instanceof FaucetConfigError);
    assert.equal(e.message, message);
    if (value) assert.ok(!e.message.includes(value), "the refused value is not repeated");
    return true;
  });
}

describe("the kill switch, FAUCET_PAUSED", () => {
  it("is off when unset, empty or plainly off", () => {
    for (const value of [undefined, null, "", "  ", "0", "false", "FALSE", "no", "off", " Off "]) {
      assert.equal(isPaused({ FAUCET_PAUSED: value }), false, `${JSON.stringify(value)}`);
    }
  });

  it("is on for any other value, so a typo stops the faucet rather than leaving it open", () => {
    for (const value of ["1", "true", "yes", "on", "paused", "ture", 1, true]) {
      assert.equal(isPaused({ FAUCET_PAUSED: value }), true, `${JSON.stringify(value)}`);
    }
  });
});

describe("the daily budgets", () => {
  it("default to a small number of drips per day for each budget", () => {
    assert.deepEqual(dailyBudgets({}), {
      unverified: DEFAULT_DAILY_DRIPS,
      verified: DEFAULT_DAILY_DRIPS_VERIFIED,
    });
    assert.deepEqual(dailyBudgets({ FAUCET_DAILY_DRIPS: "", FAUCET_DAILY_DRIPS_VERIFIED: " " }), {
      unverified: DEFAULT_DAILY_DRIPS,
      verified: DEFAULT_DAILY_DRIPS_VERIFIED,
    });
  });

  it("read a whole number, 0 included, as text or as a number", () => {
    assert.deepEqual(dailyBudgets({ FAUCET_DAILY_DRIPS: "0", FAUCET_DAILY_DRIPS_VERIFIED: 250 }), {
      unverified: 0,
      verified: 250,
    });
  });

  it("refuse anything else instead of running without a limit", () => {
    for (const value of ["lots", "-1", "1.5", "1e3", "Infinity", "10000000000"]) {
      refuses(
        () => dailyBudgets({ FAUCET_DAILY_DRIPS: value }),
        "FAUCET_DAILY_DRIPS is not a whole number.",
      );
      refuses(
        () => dailyBudgets({ FAUCET_DAILY_DRIPS_VERIFIED: value }),
        "FAUCET_DAILY_DRIPS_VERIFIED is not a whole number.",
      );
    }
  });
});

describe("the low-balance mark", () => {
  it("is 1 AVAX unless set", () => {
    assert.deepEqual(lowBalance({}), { text: "1", value: parseEther("1") });
    assert.deepEqual(lowBalance({ FAUCET_LOW_BALANCE_AVAX: "0.25" }), {
      text: "0.25",
      value: parseEther("0.25"),
    });
    // 0 switches the warning off: no balance is under it.
    assert.equal(lowBalance({ FAUCET_LOW_BALANCE_AVAX: "0" }).value, 0n);
  });

  it("refuses something that is not an amount", () => {
    for (const value of ["lots", "-1", "1,5"]) {
      refuses(
        () => lowBalance({ FAUCET_LOW_BALANCE_AVAX: value }),
        "FAUCET_LOW_BALANCE_AVAX is not a valid amount.",
      );
    }
  });
});

describe("the drip amount", () => {
  it("is FAUCET_DRIP_AVAX, as text and in wei", () => {
    assert.deepEqual(dripAmount({ FAUCET_DRIP_AVAX: "0.02" }), {
      amount: "0.02",
      value: parseEther("0.02"),
    });
  });

  it("refuses an amount that is not one, or is nothing", () => {
    for (const value of ["lots", "0", "-0.02"]) {
      refuses(
        () => dripAmount({ FAUCET_DRIP_AVAX: value }),
        "FAUCET_DRIP_AVAX is not a valid amount.",
      );
    }
  });
});

describe("TURNSTILE_ORIGINS", () => {
  it("is every caller while empty", () => {
    assert.equal(turnstileOrigins({}), null);
    assert.equal(turnstileOrigins({ TURNSTILE_ORIGINS: "  " }), null);
  });

  it("reads origins separated by commas or spaces", () => {
    assert.deepEqual(
      turnstileOrigins({
        TURNSTILE_ORIGINS: "https://avakit.dev, http://localhost:3000\nHTTPS://Docs.Example/",
      }),
      new Set(["https://avakit.dev", "http://localhost:3000", "https://docs.example"]),
    );
  });

  it("refuses an entry that a browser would never send as an Origin", () => {
    for (const value of [
      "avakit.dev",
      "https://avakit.dev/new",
      "https://avakit.dev?x=1",
      "ftp://avakit.dev",
      "https://avakit.dev, *",
    ]) {
      refuses(
        () => turnstileOrigins({ TURNSTILE_ORIGINS: value }),
        "TURNSTILE_ORIGINS is not a list of origins.",
        value,
      );
    }
  });
});

describe("whether a request needs a Turnstile token", () => {
  it("never does without TURNSTILE_SECRET, whatever the origins say", () => {
    const env = { TURNSTILE_ORIGINS: "https://avakit.dev" };
    assert.equal(tokenRequired(env, "https://avakit.dev"), false);
    assert.equal(tokenRequired(env, null), false);
  });

  it("always does with the secret and no origins, as before origins could be named", () => {
    const env = { TURNSTILE_SECRET: "s" };
    for (const origin of ["https://avakit.dev", "http://localhost:3000", null, "null"]) {
      assert.equal(tokenRequired(env, origin), true, String(origin));
    }
  });

  it("does only from the named origins once they are named", () => {
    const env = { TURNSTILE_SECRET: "s", TURNSTILE_ORIGINS: "https://avakit.dev" };
    assert.equal(tokenRequired(env, "https://avakit.dev"), true);
    assert.equal(tokenRequired(env, "https://AVAKIT.dev"), true);
    // A scaffolded app, a preview deploy, the MCP server (no Origin at all), a sandboxed frame.
    for (const origin of [
      "http://localhost:3000",
      "https://avakit-git-x.vercel.app",
      "https://avakit.dev.evil.example",
      null,
      "",
      "null",
    ]) {
      assert.equal(tokenRequired(env, origin), false, String(origin));
    }
  });
});

describe("the deployed version", () => {
  it("is the commit the deploy workflow passed in GIT_SHA", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    assert.equal(deployedVersion({ GIT_SHA: sha }), sha);
    assert.equal(deployedVersion({ GIT_SHA: sha.toUpperCase() }), sha);
    assert.equal(deployedVersion({ GIT_SHA: "abc1234" }), "abc1234");
  });

  it("is dev for a Worker deployed any other way, and never repeats anything else", () => {
    for (const value of [
      undefined,
      "",
      "main",
      "abc12",
      "0x0123456",
      "secret value",
      "g".repeat(40),
    ]) {
      assert.equal(deployedVersion({ GIT_SHA: value }), "dev", String(value));
    }
  });
});
