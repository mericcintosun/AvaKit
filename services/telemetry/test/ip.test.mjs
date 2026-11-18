import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { clientKey } from "../src/ip.js";

const OWN = fileURLToPath(new URL("../src/ip.js", import.meta.url));
const FAUCET = fileURLToPath(new URL("../../faucet/src/ip.js", import.meta.url));

describe("clientKey", () => {
  it("keys an IPv4 client by its address and an IPv6 client by its /64", () => {
    assert.equal(clientKey("203.0.113.9"), "203.0.113.9");
    assert.equal(clientKey("2001:db8:1:1::1"), "2001:db8:1:1::/64");
    assert.equal(clientKey("2001:db8:1:1:aaaa:bbbb:cccc:dddd"), "2001:db8:1:1::/64");
    assert.equal(clientKey("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(clientKey(null), "unknown");
  });

  it("is the same code as the faucet's copy", (t) => {
    // The two Workers deploy on their own, so the function is duplicated.
    // services/faucet/test/ip.test.mjs covers it in full; this keeps the copies
    // from drifting apart.
    if (!existsSync(FAUCET)) {
      t.skip("not inside the AvaKit monorepo");
      return;
    }
    // Everything after the leading doc comment, which names the other copy.
    const code = (path) => readFileSync(path, "utf8").replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
    assert.equal(code(OWN), code(FAUCET));
  });
});
