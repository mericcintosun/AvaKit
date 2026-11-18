import { describe, expect, it } from "vitest";
import { parsePort } from "./args.js";

describe("parsePort", () => {
  it("reads the port from --port, -p and --port=", () => {
    expect(parsePort(["--port", "4555"])).toBe(4555);
    expect(parsePort(["--no-open", "-p", "4555"])).toBe(4555);
    expect(parsePort(["--port=4555", "--no-open"])).toBe(4555);
    expect(parsePort(["--port", "1"])).toBe(1);
    expect(parsePort(["--port", "65535"])).toBe(65535);
  });

  it("means 'any free port' when the flag is absent or 0", () => {
    expect(parsePort([])).toBeUndefined();
    expect(parsePort(["--no-open"])).toBeUndefined();
    expect(parsePort(["--port", "0"])).toBeUndefined();
  });

  it("refuses a value that is not a port instead of silently picking another one", () => {
    for (const argv of [
      ["--port"],
      ["--port", ""],
      ["--port", "abc"],
      ["--port", "80a"],
      ["--port", "-1"],
      ["--port", "1.5"],
      ["--port", "65536"],
      ["--port", "999999"],
      ["--port="],
      ["-p", "--no-open"],
    ]) {
      expect(() => parsePort(argv), argv.join(" ")).toThrow(/--port expects a port number/);
    }
  });
});
