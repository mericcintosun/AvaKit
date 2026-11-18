import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import {
  coerceArgs,
  constructorArgs,
  describeFunction,
  normalizeAbi,
  selectFunction,
  writeFunctions,
} from "./abi.js";
import { MAX_ABI_ITEMS } from "./guards.js";

const erc721 = parseAbi([
  "function mint() returns (uint256)",
  "function approve(address approved, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function name() pure returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

describe("normalizeAbi", () => {
  it("accepts the compiler's JSON form", () => {
    const json = [
      {
        type: "function",
        name: "mint",
        inputs: [],
        outputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
        stateMutability: "nonpayable",
      },
      { type: "event", name: "Minted", inputs: [], anonymous: false },
      { type: "receive", stateMutability: "payable" },
    ];
    expect(normalizeAbi(json)).toEqual(json);
    expect(normalizeAbi([])).toEqual([]);
  });

  it("accepts human-readable signatures, so one function can be called without a whole ABI", () => {
    const abi = normalizeAbi(["function mint() returns (uint256)"]);
    expect(abi).toEqual([
      {
        type: "function",
        name: "mint",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [{ type: "uint256" }],
      },
    ]);
    expect(encodeFunctionData({ abi, functionName: "mint" })).toBe("0x1249c58b");
  });

  it("reads a bare name(…) as a function, the way people write one", () => {
    expect(normalizeAbi(["mint()", "transfer(address to, uint256 amount) returns (bool)"])).toEqual(
      normalizeAbi([
        "function mint()",
        "function transfer(address to, uint256 amount) returns (bool)",
      ]),
    );
    // Structs, constructors and errors keep their own keyword.
    const abi = normalizeAbi([
      "struct Order { address maker; uint256 amount; }",
      "constructor(address owner)",
      "error SoldOut(uint256 max)",
      "function fill(Order order) payable",
    ]);
    expect(abi.map((item) => item.type)).toEqual(["constructor", "error", "function"]);
  });

  it("says what is wrong with a signature that does not parse", () => {
    expect(() => normalizeAbi(["function mint() returnz (uint256)"])).toThrow(
      /Could not read the ABI signatures: Invalid ABI parameter\. \(at "\) returnz \(uint256"\) Give the ABI either as/,
    );
    expect(() => normalizeAbi(["function mint(uint257 x)"])).toThrow(
      /Type "uint257" is not a valid ABI type/,
    );
    // The parser's version footer is noise to an agent.
    expect(() => normalizeAbi(["not a signature"])).not.toThrow(/Version:/);
    expect(() => normalizeAbi(["not a signature"])).toThrow(/Could not read the ABI signatures/);
  });

  it("refuses an ABI that is neither form, instead of failing inside the encoder", () => {
    const malformed: unknown[][] = [
      ["function mint()", { type: "function", name: "burn", inputs: [] }],
      [42],
      [null],
      [[]],
      [{ name: "mint" }],
      [{ type: "method", name: "mint" }],
      [{ type: "function", inputs: [] }],
      [{ type: "function", name: "mint", inputs: "none" }],
      [{ type: "function", name: "mint", inputs: [{ name: "to" }] }],
    ];
    for (const abi of malformed) {
      expect(() => normalizeAbi(abi), JSON.stringify(abi)).toThrow(/The ABI is malformed/);
    }
  });

  it("fills in what older or partial JSON ABIs leave out", () => {
    const [legacyView, legacyPayable, bare] = normalizeAbi([
      { type: "function", name: "total", constant: true, inputs: [] },
      { type: "function", name: "buy", payable: true, inputs: [] },
      { type: "function", name: "mint" },
    ]);
    expect(legacyView).toMatchObject({ stateMutability: "view" });
    expect(legacyPayable).toMatchObject({ stateMutability: "payable" });
    expect(bare).toMatchObject({ stateMutability: "nonpayable", inputs: [], outputs: [] });
  });

  it("keeps the bound on the number of entries", () => {
    const tooMany = Array.from({ length: MAX_ABI_ITEMS + 1 }, () => "function f()");
    expect(() => normalizeAbi(tooMany)).toThrow(/at most 5000 are accepted/);
    expect(() => normalizeAbi([`function f(${"uint256,".repeat(400)}uint256)`])).toThrow(
      /characters long/,
    );
  });
});

describe("selectFunction", () => {
  it("finds a function by name and prepares its arguments", () => {
    expect(selectFunction(erc721, "mint")).toMatchObject({ item: { name: "mint" }, args: [] });
    const approve = selectFunction(erc721, "approve", [
      "0x00000000000000000000000000000000000000aa",
      "7",
    ]);
    expect(approve.args).toEqual(["0x00000000000000000000000000000000000000aa", 7n]);
  });

  it("lists the functions there are when the name matches none", () => {
    expect(() => selectFunction(erc721, "burn")).toThrow(
      'No function "burn" in the ABI. Its state-changing functions: mint(), ' +
        "approve(address approved, uint256 tokenId), " +
        "safeTransferFrom(address from, address to, uint256 tokenId), " +
        "safeTransferFrom(address from, address to, uint256 tokenId, bytes data).",
    );
    expect(() =>
      selectFunction(parseAbi(["function total() view returns (uint256)"]), "x"),
    ).toThrow("It has no state-changing functions at all.");
  });

  it("says which arguments a function takes when the count is wrong", () => {
    expect(() => selectFunction(erc721, "approve")).toThrow(
      '"approve" does not take 0 arguments. Its form is approve(address approved, uint256 tokenId); ' +
        "pass the values as args, in that order.",
    );
    expect(() => selectFunction(erc721, "safeTransferFrom", [1])).toThrow(/Its forms are /);
  });

  it("refuses a read-only function and points at the tool that reads", () => {
    for (const [name, args] of [
      ["ownerOf", [1]],
      ["name", []],
    ] as const) {
      expect(() => selectFunction(erc721, name, args)).toThrow(
        `"${name}" is a read-only (view) function, so there is nothing to send. Read it with read_chain`,
      );
    }
  });

  it("picks between overloads by the number of arguments", () => {
    const from = "0x00000000000000000000000000000000000000aa";
    const to = "0x00000000000000000000000000000000000000bb";
    expect(selectFunction(erc721, "safeTransferFrom", [from, to, 1]).item.inputs).toHaveLength(3);
    expect(
      selectFunction(erc721, "safeTransferFrom", [from, to, 1, "0x"]).item.inputs,
    ).toHaveLength(4);
  });

  it("takes a full signature, and asks for one when the arguments cannot tell overloads apart", () => {
    const ambiguous = parseAbi(["function set(uint256 value)", "function set(address who)"]);
    expect(() =>
      selectFunction(ambiguous, "set", ["0x00000000000000000000000000000000000000aa"]),
    ).toThrow(
      '"set" has 2 forms that take 1 argument: set(uint256 value), set(address who). ' +
        'Pass functionName as the full signature of the one you mean, for example "set(uint256)".',
    );
    expect(
      selectFunction(ambiguous, "set(address)", ["0x00000000000000000000000000000000000000aa"]).item
        .inputs[0]?.type,
    ).toBe("address");
    // Spaces and parameter names in what was typed do not matter.
    expect(selectFunction(ambiguous, " set( uint256 value ) ", [5]).args).toEqual([5n]);
    expect(() => selectFunction(ambiguous, "set(bool)", [true])).toThrow(
      /No function "set\(bool\)"/,
    );
  });
});

describe("coerceArgs", () => {
  const inputs = (signature: string) => {
    const [item] = normalizeAbi([signature]);
    if (item?.type !== "function") throw new Error("not a function");
    return item.inputs;
  };

  it("turns integers into bigints, from numbers and from strings", () => {
    expect(
      coerceArgs(inputs("function f(uint256 a, int8 b, uint64 c)"), [5, "-3", "0xff"]),
    ).toEqual([5n, -3n, 255n]);
    // More than a double can hold, intact.
    expect(coerceArgs(inputs("function f(uint256 a)"), ["1000000000000000000000001"])).toEqual([
      1000000000000000000000001n,
    ]);
  });

  it("refuses a JSON number that has already lost digits, rather than encode another amount", () => {
    // 1000000000000000000001 arrives from JSON.parse as 1e+21. Encoded as it
    // stands, it would put a different number on chain with no error at all.
    expect(() => coerceArgs(inputs("function f(uint256 amount)"), [1e21])).toThrow(
      "args[0] (uint256 amount) is 1e+21: a JSON number that cannot hold an integer of that size exactly. " +
        'Pass it as a decimal string instead, for example "1000000000000000000".',
    );
    expect(() => coerceArgs(inputs("function f(uint256 amount)"), [2 ** 53])).toThrow(
      /cannot hold an integer of that size exactly/,
    );
    expect(() => coerceArgs(inputs("function f(uint256 amount)"), [1.5])).toThrow(
      /cannot hold an integer/,
    );
  });

  it("refuses something that is not a whole number where one is needed", () => {
    for (const value of ["1e18", "12.5", "ten", "", true, null, {}]) {
      expect(
        () => coerceArgs(inputs("function f(uint256 amount)"), [value]),
        String(value),
      ).toThrow(/args\[0\] \(uint256 amount\) must be a whole number/);
    }
  });

  it("reaches into arrays and tuples, and leaves everything else for the encoder", () => {
    const [ids, order, who, flag] = coerceArgs(
      inputs(
        "function f(uint256[] ids, (address maker, uint256 amount, uint8[2] pair) order, address who, bool flag)",
      ),
      [["1", 2], { maker: "0xaa", amount: "9", pair: [1, "2"] }, "0xbb", true],
    );
    expect(ids).toEqual([1n, 2n]);
    expect(order).toEqual({ maker: "0xaa", amount: 9n, pair: [1n, 2n] });
    expect([who, flag]).toEqual(["0xbb", true]);

    // A tuple given positionally stays positional.
    expect(
      coerceArgs(inputs("function f((address maker, uint256 amount) order)"), [["0xaa", "9"]]),
    ).toEqual([["0xaa", 9n]]);
  });

  it("names the place when a nested value has the wrong shape", () => {
    expect(() => coerceArgs(inputs("function f(uint256[] ids)"), [5])).toThrow(
      "args[0] (uint256[]) must be an array.",
    );
    expect(() => coerceArgs(inputs("function f(uint256[] ids)"), [[1, "x"]])).toThrow(
      /args\[0\]\[1\]/,
    );
    expect(() =>
      coerceArgs(inputs("function f((address maker, uint256 amount) order)"), [["0xaa"]]),
    ).toThrow("args[0] (tuple) has 2 fields, but 1 were given.");
    expect(() =>
      coerceArgs(inputs("function f((address maker, uint256 amount) order)"), [
        { maker: "0xaa", amount: "x" },
      ]),
    ).toThrow(/args\[0\]\.amount/);
  });
});

describe("constructorArgs", () => {
  it("matches the arguments to the constructor before anything is encoded", () => {
    const abi = parseAbi(["constructor(address owner, uint256 cap)"]);
    expect(constructorArgs(abi, ["0xaa", "5"])).toEqual(["0xaa", 5n]);
    expect(() => constructorArgs(abi)).toThrow(
      "The constructor takes 2 arguments, constructor(address owner, uint256 cap), but args has 0.",
    );
    expect(() => constructorArgs(abi, [1])).toThrow(/but args has 1/);
  });

  it("accepts no arguments for a contract without a constructor, and refuses any", () => {
    expect(constructorArgs([])).toEqual([]);
    expect(constructorArgs(erc721, [])).toEqual([]);
    expect(() => constructorArgs([], [1])).toThrow(
      "This contract's constructor takes no arguments, but args has 1. Leave args out.",
    );
  });
});

describe("describing an ABI", () => {
  it("lists the functions that change state, in the ABI's order", () => {
    expect(writeFunctions(erc721).map(describeFunction)).toEqual([
      "mint()",
      "approve(address approved, uint256 tokenId)",
      "safeTransferFrom(address from, address to, uint256 tokenId)",
      "safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
    ]);
  });
});
