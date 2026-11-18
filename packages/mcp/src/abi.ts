/**
 * ABIs as an agent sends them, turned into something safe to encode with.
 *
 * Three things go wrong when an untyped JSON payload meets an ABI encoder, and
 * each of them used to surface as a stack of library internals — or, worse, not
 * surface at all:
 *
 *   • the ABI itself is malformed, or is a list of signatures rather than JSON;
 *   • the function name matches nothing, or several overloads;
 *   • a large integer arrives as a JSON number, which has already lost digits
 *     by the time anyone can look at it.
 */

import { type Abi, type AbiFunction, type AbiParameter, parseAbi, toFunctionSignature } from "viem";
import { ToolError } from "./errors.js";
import { MAX_ABI_ITEMS } from "./guards.js";

/** Longest human-readable signature accepted; real ones are far shorter. */
const MAX_SIGNATURE_LENGTH = 2000;
/** How many functions an error message lists before it stops. */
const MAX_LISTED = 25;

const SIGNATURE_KEYWORD = /^(function|event|error|constructor|fallback|receive|struct)\b/;
const BARE_FUNCTION = /^[A-Za-z_$][\w$]*\s*\(/;
const ITEM_TYPES = new Set(["function", "constructor", "event", "error", "fallback", "receive"]);

const ABI_FORMS =
  "Give the ABI either as the compiler's JSON array, or as an array of signatures such as " +
  '["function mint() returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"].';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSignatures(signatures: readonly string[]): Abi {
  const lines = signatures.map((signature) => {
    const line = signature.trim();
    if (line.length > MAX_SIGNATURE_LENGTH) {
      throw new ToolError(`An ABI signature is ${line.length} characters long. ${ABI_FORMS}`);
    }
    // "mint()" is how people write a function when the keyword is obvious.
    return !SIGNATURE_KEYWORD.test(line) && BARE_FUNCTION.test(line) ? `function ${line}` : line;
  });
  try {
    return parseAbi(lines) as Abi;
  } catch (error) {
    // The parser's message without its version footer: what it objected to,
    // and the piece of text it was looking at.
    const said = (error instanceof Error ? error.message : "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("Version:"))
      .map((line) => (line.startsWith("Details: ") ? `(at "${line.slice(9, 200)}")` : line))
      .join(" ");
    throw new ToolError(
      `Could not read the ABI signatures: ${said || "they are not Solidity signatures."} ${ABI_FORMS}`,
    );
  }
}

function checkParameters(parameters: unknown, where: string, depth = 0): AbiParameter[] {
  if (parameters === undefined) return [];
  if (!Array.isArray(parameters) || depth > 16) {
    throw new ToolError(`The ABI is malformed: ${where} is not a list of parameters. ${ABI_FORMS}`);
  }
  return parameters.map((parameter, index) => {
    if (!isRecord(parameter) || typeof parameter.type !== "string") {
      throw new ToolError(
        `The ABI is malformed: parameter ${index} of ${where} has no "type". ${ABI_FORMS}`,
      );
    }
    if (!parameter.type.startsWith("tuple")) return parameter as unknown as AbiParameter;
    return {
      ...parameter,
      components: checkParameters(parameter.components, `${where}.${index}`, depth + 1),
    } as unknown as AbiParameter;
  });
}

/**
 * An ABI from a tool argument or an artifact file, checked and in viem's form.
 *
 * Accepts the compiler's JSON array or an array of human-readable signatures
 * (`"function mint() returns (uint256)"`), which is all an agent needs to call
 * one function and far less to get wrong than 360 lines of JSON.
 */
export function normalizeAbi(input: readonly unknown[]): Abi {
  if (input.length > MAX_ABI_ITEMS) {
    throw new ToolError(
      `The ABI has ${input.length} entries; at most ${MAX_ABI_ITEMS} are accepted.`,
    );
  }
  if (input.length > 0 && input.every((item) => typeof item === "string")) {
    return parseSignatures(input as string[]);
  }
  return input.map((item, index) => {
    if (!isRecord(item) || typeof item.type !== "string" || !ITEM_TYPES.has(item.type)) {
      throw new ToolError(`The ABI is malformed: entry ${index} is not an ABI item. ${ABI_FORMS}`);
    }
    const where = typeof item.name === "string" ? `"${item.name}"` : `the ${item.type}`;
    if (item.type === "fallback" || item.type === "receive") return item;
    if (item.type !== "constructor" && typeof item.name !== "string") {
      throw new ToolError(`The ABI is malformed: entry ${index} (${item.type}) has no "name".`);
    }
    const inputs = checkParameters(item.inputs, where);
    if (item.type !== "function") return { ...item, inputs };
    return {
      ...item,
      inputs,
      outputs: checkParameters(item.outputs, `${where} outputs`),
      // ABIs from before Solidity 0.6 say `constant` / `payable` instead.
      stateMutability:
        typeof item.stateMutability === "string"
          ? item.stateMutability
          : item.constant === true
            ? "view"
            : item.payable === true
              ? "payable"
              : "nonpayable",
    };
  }) as unknown as Abi;
}

/** `mint(address to, uint256 amount)`: a function as a person would write it. */
export function describeFunction(item: { name?: string; inputs: readonly AbiParameter[] }): string {
  const parameters = item.inputs.map((input) =>
    input.name ? `${input.type} ${input.name}` : input.type,
  );
  return `${item.name ?? "constructor"}(${parameters.join(", ")})`;
}

function isStateChanging(item: AbiFunction): boolean {
  return item.stateMutability !== "view" && item.stateMutability !== "pure";
}

/** The functions of an ABI that change state, in the ABI's order. */
export function writeFunctions(abi: Abi): AbiFunction[] {
  return abi.filter(
    (item): item is AbiFunction => item.type === "function" && isStateChanging(item),
  );
}

function listed(functions: readonly AbiFunction[]): string {
  const shown = functions.slice(0, MAX_LISTED).map(describeFunction).join(", ");
  return functions.length > MAX_LISTED
    ? `${shown}, and ${functions.length - MAX_LISTED} more`
    : shown;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** `name(type,type)` for a full signature a caller typed, or undefined if it is not one. */
function canonical(signature: string): string | undefined {
  try {
    return toFunctionSignature(signature.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1"));
  } catch {
    return undefined;
  }
}

function asInteger(value: unknown, parameter: AbiParameter, where: string): bigint {
  const what = `${where} (${parameter.name ? `${parameter.type} ${parameter.name}` : parameter.type})`;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    // JSON has one number type and it is a double: 1000000000000000000001 has
    // already become 1e21 here. Encoding that would put a different amount on
    // chain than the one that was asked for, without any error.
    if (!Number.isSafeInteger(value)) {
      throw new ToolError(
        `${what} is ${value}: a JSON number that cannot hold an integer of that size exactly. ` +
          'Pass it as a decimal string instead, for example "1000000000000000000".',
      );
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^(-?\d+|0x[0-9a-fA-F]+)$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  const got = typeof value === "string" ? JSON.stringify(value.slice(0, 80)) : typeof value;
  throw new ToolError(
    `${what} must be a whole number: a JSON number, or a decimal string for large values. Got ${got}.`,
  );
}

function coerce(parameter: AbiParameter, value: unknown, where: string): unknown {
  const array = /^(.*)\[\d*\]$/.exec(parameter.type);
  if (array) {
    if (!Array.isArray(value)) {
      throw new ToolError(`${where} (${parameter.type}) must be an array.`);
    }
    const element = { ...parameter, type: array[1] } as AbiParameter;
    return value.map((item, index) => coerce(element, item, `${where}[${index}]`));
  }
  if (parameter.type === "tuple") {
    const components = (parameter as { components?: readonly AbiParameter[] }).components ?? [];
    if (Array.isArray(value)) {
      if (value.length !== components.length) {
        throw new ToolError(
          `${where} (tuple) has ${count(components.length, "field")}, but ${value.length} were given.`,
        );
      }
      return components.map((component, index) =>
        coerce(component, value[index], `${where}[${index}]`),
      );
    }
    if (isRecord(value) && components.every((component) => component.name)) {
      return Object.fromEntries(
        components.map((component) => [
          component.name,
          coerce(component, value[component.name as string], `${where}.${component.name}`),
        ]),
      );
    }
    throw new ToolError(`${where} (tuple) must be an array of its fields, in order.`);
  }
  if (/^u?int\d*$/.test(parameter.type)) return asInteger(value, parameter, where);
  return value;
}

/**
 * Tool arguments shaped for the encoder: integers become bigints (from a JSON
 * number that is exact, or from a string), and everything else is passed on for
 * viem to validate.
 */
export function coerceArgs(
  inputs: readonly AbiParameter[],
  args: readonly unknown[],
  where = "args",
): unknown[] {
  return inputs.map((input, index) => coerce(input, args[index], `${where}[${index}]`));
}

/** The constructor's arguments, checked against the ABI, ready to encode. */
export function constructorArgs(abi: Abi, args: readonly unknown[] = []): unknown[] {
  const item = abi.find((entry) => entry.type === "constructor");
  const inputs = item?.inputs ?? [];
  if (inputs.length !== args.length) {
    // viem appends nothing when a constructor expects arguments and none were
    // given, and the creation then reverts on chain for no visible reason.
    throw new ToolError(
      inputs.length === 0
        ? `This contract's constructor takes no arguments, but args has ${args.length}. Leave args out.`
        : `The constructor takes ${count(inputs.length, "argument")}, ` +
            `${describeFunction({ inputs })}, but args has ${args.length}.`,
    );
  }
  return coerceArgs(inputs, args);
}

export interface SelectedFunction {
  item: AbiFunction;
  args: unknown[];
}

/**
 * The one state-changing function a call means, with its arguments ready to
 * encode — or an error that says which functions there are.
 *
 * `functionName` is a name (`"mint"`) or, to pick between overloads that take
 * the same number of arguments, a full signature (`"mint(address,uint256)"`).
 */
export function selectFunction(
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): SelectedFunction {
  const wanted = functionName.trim();
  const functions = abi.filter((item): item is AbiFunction => item.type === "function");
  const signature = wanted.includes("(") ? canonical(wanted) : undefined;
  const named = functions.filter((item) =>
    signature ? toFunctionSignature(item) === signature : item.name === wanted,
  );
  if (named.length === 0) {
    const writable = writeFunctions(abi);
    throw new ToolError(
      `No function "${wanted.slice(0, 200)}" in the ABI. ` +
        (writable.length > 0
          ? `Its state-changing functions: ${listed(writable)}.`
          : "It has no state-changing functions at all."),
    );
  }
  const fitting = named.filter((item) => item.inputs.length === args.length);
  if (fitting.length === 0) {
    throw new ToolError(
      `"${named[0]?.name}" does not take ${count(args.length, "argument")}. ` +
        `Its form${named.length === 1 ? " is" : "s are"} ${listed(named)}; pass the values as args, in that order.`,
    );
  }
  const writable = fitting.filter(isStateChanging);
  if (writable.length === 0) {
    throw new ToolError(
      `"${fitting[0]?.name}" is a read-only (view) function, so there is nothing to send. ` +
        `Read it with read_chain: { action: "contractRead", address, abi, functionName: "${fitting[0]?.name}" }.`,
    );
  }
  const [item] = writable;
  if (!item || writable.length > 1) {
    throw new ToolError(
      `"${writable[0]?.name}" has ${writable.length} forms that take ${count(args.length, "argument")}: ` +
        `${listed(writable)}. Pass functionName as the full signature of the one you mean, ` +
        `for example "${writable[0] ? toFunctionSignature(writable[0]) : wanted}".`,
    );
  }
  return { item, args: coerceArgs(item.inputs, args) };
}
