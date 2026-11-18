import {
  type Abi,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  ExecutionRevertedError,
  type Hex,
  HttpRequestError,
  isHex,
  RpcRequestError,
} from "viem";

/**
 * A refusal or failure whose message was written for the caller and is returned
 * as it stands: it says what happened and what to do next, and it never carries
 * a key, the contents of a file, or a library's multi-line dump.
 */
export class ToolError extends Error {
  override name = "ToolError";
}

/** Longest reason passed on from a library or a server. Enough for a sentence, not for a dump. */
const MAX_REASON = 400;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_REASON ? `${flat.slice(0, MAX_REASON)}…` : flat;
}

function formatArgs(args: readonly unknown[] | undefined): string {
  return (args ?? [])
    .map((arg) => (typeof arg === "bigint" ? arg.toString() : String(arg)))
    .join(", ");
}

/** The revert data a node attached to a failed `eth_call` or `eth_estimateGas`, if any. */
function revertData(error: BaseError): Hex | undefined {
  const carrier = error.walk(
    (cause) => isHex((cause as { data?: unknown }).data) && (cause as { data: Hex }).data !== "0x",
  );
  return carrier ? (carrier as unknown as { data: Hex }).data : undefined;
}

/** What a revert that came with nothing attached is reported as. */
export const NO_REASON = "no reason given";

/** A reason string in quotes, without the "execution reverted:" a node puts in front of it. */
function quoted(reason: string): string {
  const said = oneLine(reason.replace(/^execution reverted:?\s*/i, ""));
  return said ? `"${said}"` : NO_REASON;
}

/** How a call reverted, in a few words, or undefined when `error` is not a revert. */
export function revertReason(error: unknown, abi: Abi = []): string | undefined {
  if (!(error instanceof BaseError)) return undefined;

  // A contract call viem already decoded against the ABI.
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    const name = reverted.data?.errorName;
    if (name && name !== "Error" && name !== "Panic") {
      return `custom error ${name}(${formatArgs(reverted.data?.args)})`;
    }
    if (reverted.reason) return quoted(reverted.reason);
    if (reverted.signature) {
      return `an error that is not in the ABI (selector ${reverted.signature})`;
    }
  }

  // A creation or a plain call: the node sent the revert data, nobody decoded it.
  const data = revertData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi, data });
      if (decoded.errorName === "Error") return quoted(String(decoded.args?.[0] ?? ""));
      if (decoded.errorName === "Panic") return `a Solidity panic (code ${decoded.args?.[0]})`;
      return `custom error ${decoded.errorName}(${formatArgs(decoded.args)})`;
    } catch {
      return `an error that is not in the ABI (selector ${data.slice(0, 10)})`;
    }
  }

  const node = error.walk((cause) => cause instanceof ExecutionRevertedError);
  if (node instanceof ExecutionRevertedError) return quoted(node.details ?? "");
  return undefined;
}

/**
 * Why something failed, in one line. viem's own messages run to a dozen lines
 * with the RPC URL and the whole request body; a tool result should carry the
 * sentence that says what went wrong and leave the rest out.
 */
export function reasonOf(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  if (error instanceof BaseError) {
    // What the node itself said, when it answered at all. viem files every
    // error -32000 under "Missing or invalid parameters", which it seldom is.
    const rpc = error.walk((cause) => cause instanceof RpcRequestError);
    if (rpc instanceof RpcRequestError && rpc.details) return oneLine(rpc.details);
    const http = error.walk((cause) => cause instanceof HttpRequestError);
    if (http instanceof HttpRequestError) {
      return http.status
        ? `the RPC answered HTTP ${http.status}`
        : `the RPC could not be reached (${oneLine(http.details)})`;
    }
    const short = oneLine(error.shortMessage);
    const details = error.details ? oneLine(error.details) : "";
    return details && !short.includes(details) ? `${short} (${details})` : short;
  }
  return oneLine(error instanceof Error ? error.message : String(error));
}
