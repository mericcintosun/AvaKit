import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientKey } from "../src/ip.js";

describe("clientKey", () => {
  it("keys an IPv4 client by its address", () => {
    assert.equal(clientKey("203.0.113.9"), "203.0.113.9");
    assert.equal(clientKey(" 203.0.113.9 "), "203.0.113.9");
  });

  it("keys every address in one IPv6 /64 the same way", () => {
    const keys = new Set(
      [
        "2001:db8:1:1::1",
        "2001:db8:1:1::2",
        "2001:db8:1:1:ffff:ffff:ffff:ffff",
        "2001:0db8:0001:0001:0000:0000:0000:0003",
        "2001:DB8:1:1:a:b:c:d",
        "2001:db8:1:1::",
      ].map(clientKey),
    );
    assert.deepEqual([...keys], ["2001:db8:1:1::/64"]);
  });

  it("keeps neighbouring /64s apart", () => {
    assert.notEqual(clientKey("2001:db8:1:1::1"), clientKey("2001:db8:1:2::1"));
    assert.notEqual(clientKey("2001:db8:1:1::1"), clientKey("2001:db8:2:1::1"));
    assert.equal(clientKey("2001:db8::1"), "2001:db8:0:0::/64");
    assert.equal(clientKey("::1"), "0:0:0:0::/64");
  });

  it("treats an IPv4-mapped address as the IPv4 host it is", () => {
    assert.equal(clientKey("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(clientKey("::ffff:cb00:7109"), "203.0.113.9");
    assert.equal(clientKey("0:0:0:0:0:ffff:203.0.113.9"), "203.0.113.9");
  });

  it("ignores an IPv6 zone id", () => {
    assert.equal(clientKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  });

  it("gives a missing address one shared key", () => {
    assert.equal(clientKey(null), "unknown");
    assert.equal(clientKey(undefined), "unknown");
    assert.equal(clientKey(""), "unknown");
  });

  it("keeps a malformed address as its own key instead of guessing", () => {
    for (const odd of ["1:2:3", "2001:db8:::1", "2001:db8::1::2", "gggg::1", "1:2:3:4:5:6:7:8:9"]) {
      assert.equal(clientKey(odd), odd);
    }
  });
});
