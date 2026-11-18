import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Connection, connect } from "./testing/connect.js";
import { type FakeNetwork, fakeNetwork } from "./testing/network.js";

const CONTRACT = "0x00000000000000000000000000000000000000c1";
const ALICE = getAddress("0x00000000000000000000000000000000000000aa");
const OWNER_OF = ["function ownerOf(uint256 tokenId) view returns (address)"];

// read_chain's contractRead. It takes the ABI the way write_contract does, so
// an agent that was handed an artifact path by scaffold_app can read the
// contract it just deployed without opening the file or writing a JSON ABI.
//
// The network is fake; the encoding and the decoding are real.
describe("read_chain contractRead", () => {
  let mcp: Connection;
  beforeAll(async () => {
    mcp = await connect();
  });
  afterAll(() => mcp.close());

  let net: FakeNetwork;
  let base: string;
  let cwd: string;

  beforeEach(() => {
    net = fakeNetwork();
    net.fuji.setCode(CONTRACT);
    net.fuji.callResult = encodeAbiParameters([{ type: "address" }], [ALICE]);
    vi.stubEnv("AVAKIT_MCP_ROOT", "");
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-read-")));
    cwd = path.join(base, "work");
    mkdirSync(path.join(cwd, "lib"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    writeFileSync(
      path.join(cwd, "lib", "nft-artifact.ts"),
      `export const abi = ${JSON.stringify([
        { type: "function", name: "mint", inputs: [], outputs: [], stateMutability: "nonpayable" },
        {
          type: "function",
          name: "ownerOf",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "address" }],
          stateMutability: "view",
        },
        {
          type: "function",
          name: "totalSupply",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ])} as const;\n\nexport const bytecode = "0x6080" as Hex;\n`,
    );
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const read = (args: Record<string, unknown>) =>
    mcp.call("read_chain", { action: "contractRead", address: CONTRACT, ...args });

  /** The calldata of the only `eth_call` the node received. */
  const calldata = () => {
    const calls = net.fuji.callsTo("eth_call");
    expect(calls).toHaveLength(1);
    return (calls[0]?.[0] as { data?: string }).data;
  };

  it("reads a function given only its signature", async () => {
    const result = await read({ abi: OWNER_OF, functionName: "ownerOf", args: [1] });
    expect(result.isError).toBe(false);
    expect(result.json()).toBe(ALICE);
    expect(calldata()).toBe(
      encodeFunctionData({ abi: parseAbi(OWNER_OF), functionName: "ownerOf", args: [1n] }),
    );
  });

  it("reads a function from the artifact file scaffold_app returned", async () => {
    const result = await read({
      artifactPath: "lib/nft-artifact.ts",
      functionName: "ownerOf",
      args: ["1"],
    });
    expect(result.isError).toBe(false);
    expect(result.json()).toBe(ALICE);
  });

  it("still takes the compiler's JSON ABI", async () => {
    net.fuji.callResult = encodeAbiParameters([{ type: "uint256" }], [7n]);
    const result = await read({
      abi: [
        {
          type: "function",
          name: "totalSupply",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ],
      functionName: "totalSupply",
    });
    expect(result.isError).toBe(false);
    expect(result.json()).toBe("7");
  });

  it("picks an overload by its full signature", async () => {
    net.fuji.callResult = encodeAbiParameters([{ type: "uint256" }], [3n]);
    const abi = [
      "function balanceOf(address owner) view returns (uint256)",
      "function balanceOf(uint256 id) view returns (uint256)",
    ];
    const vague = await read({ abi, functionName: "balanceOf", args: [1] });
    expect(vague.isError).toBe(true);
    expect(vague.text).toContain('"balanceOf" has 2 forms that take 1 argument');
    expect(net.fuji.callsTo("eth_call")).toEqual([]);

    const exact = await read({ abi, functionName: "balanceOf(uint256)", args: [1] });
    expect(exact.isError).toBe(false);
    expect(exact.json()).toBe("3");
  });

  it("refuses a number that JSON has already rounded, before asking the chain", async () => {
    const result = await read({
      abi: OWNER_OF,
      functionName: "ownerOf",
      args: [1e21],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Pass it as a decimal string instead");
    expect(net.fuji.callsTo("eth_call")).toEqual([]);
  });

  it("does not call a state-changing function, and says which tool sends it", async () => {
    const result = await read({ artifactPath: "lib/nft-artifact.ts", functionName: "mint" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      '"mint" changes state, so read_chain does not call it: a read would show what the call ' +
        "returns without anything happening on chain. " +
        'Send it with write_contract: { address, functionName: "mint" } and the same ABI.',
    );
    expect(net.fuji.callsTo("eth_call")).toEqual([]);
  });

  it("names the functions there are to read when the name matches none", async () => {
    const result = await read({ artifactPath: "lib/nft-artifact.ts", functionName: "owner" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'No function "owner" in the ABI. Its read-only functions: ownerOf(uint256 tokenId), totalSupply().',
    );
  });

  it("takes the ABI one way or the other, never both and never neither", async () => {
    const both = await read({
      artifactPath: "lib/nft-artifact.ts",
      abi: OWNER_OF,
      functionName: "ownerOf",
      args: [1],
    });
    expect(both.isError).toBe(true);
    expect(both.text).toBe("read_chain takes the ABI as artifactPath or as abi, not both.");

    const neither = await read({ functionName: "ownerOf", args: [1] });
    expect(neither.isError).toBe(true);
    expect(neither.text).toContain("read_chain needs the contract's ABI: pass artifactPath");
    expect(net.fuji.callsTo("eth_call")).toEqual([]);
  });

  it("refuses an artifact file outside the working directory", async () => {
    writeFileSync(path.join(base, "abi.json"), JSON.stringify({ abi: OWNER_OF }));
    const result = await read({
      artifactPath: path.join(base, "abi.json"),
      functionName: "ownerOf",
      args: [1],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Refusing to read");
    expect(net.fuji.callsTo("eth_call")).toEqual([]);
  });

  it("asks for what is missing, and accepts only a well-formed address", async () => {
    const noFunction = await mcp.call("read_chain", {
      action: "contractRead",
      address: CONTRACT,
      abi: OWNER_OF,
    });
    expect(noFunction.isError).toBe(true);
    expect(noFunction.text).toBe(
      "contractRead requires 'address', 'functionName' and the contract's ABI (artifactPath or abi).",
    );

    const badAddress = await read({
      address: "0x1234",
      abi: OWNER_OF,
      functionName: "ownerOf",
      args: [1],
    });
    expect(badAddress.isError).toBe(true);
    expect(badAddress.text).toBe(
      "contractRead: 'address' must be a 0x-prefixed, 40-hex-character address.",
    );
    expect(net.fuji.callsTo("eth_call")).toEqual([]);
  });

  it("reports a failing read in one line, without the library's dump", async () => {
    net.fuji.callFailure = { code: 3, message: "execution reverted: no such token" };
    const result = await read({ abi: OWNER_OF, functionName: "ownerOf", args: [99] });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("read_chain failed: ")).toBe(true);
    expect(result.text).toContain("no such token");
    expect(result.text).not.toContain("\n");
    expect(result.text).not.toContain("Version: viem");
  });
});
