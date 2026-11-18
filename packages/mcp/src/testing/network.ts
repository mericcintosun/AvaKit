/**
 * Test helper: a fake Avalanche behind a stubbed global `fetch`.
 *
 * The signing tools are tested against this instead of against mocks of viem,
 * so that everything on this side of the network boundary is the real thing:
 * the real transport, the real fee and gas logic, and above all the real
 * signature. A node here decodes each raw transaction it is sent and recovers
 * who signed it, which is what lets a test assert the properties that matter —
 * which chain id was signed, how much value, from which address — rather than
 * that some function was called.
 *
 * Nothing leaves the process: a request to any URL that is not one of the two
 * chains or the faucet is recorded in `strays` and fails. Undo the stub with
 * `vi.unstubAllGlobals()` in an `afterEach`.
 */

import { cChain, fuji } from "@avakit/core";
import {
  type Address,
  getContractAddress,
  type Hex,
  keccak256,
  numberToHex,
  parseTransaction,
  recoverTransactionAddress,
} from "viem";
import { vi } from "vitest";
import { DEFAULT_FAUCET_URL } from "../faucet.js";
import { clock } from "../time.js";

/** A JSON-RPC error a node answers with. */
export interface RpcFailure {
  code: number;
  message: string;
  data?: Hex;
}

/** A transaction a node accepted, decoded, with its recovered signer. */
export interface SentTransaction {
  hash: Hex;
  from: Address;
  /** Null for a contract creation. */
  to: Address | null;
  data: Hex;
  value: bigint;
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  type: string;
  /** The address the creation produced, when it was one. */
  created: Address | null;
}

type Handler = (params: unknown[]) => unknown;

/** The first parameter of `eth_call` and `eth_estimateGas`, as far as this node reads it. */
interface CallRequest {
  from?: string;
  value?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
}

const key = (address: string) => address.toLowerCase();
const hex = (value: bigint | number) => numberToHex(value);
const ZERO_HASH = `0x${"00".repeat(32)}` as const;

/** Code a successful creation leaves behind: anything that is not empty. */
const RUNTIME_CODE = "0x6080604052" as const;

export class FakeNode {
  /** The RPC URL as `fetch` sees it. */
  readonly url: string;
  /** What `eth_chainId` answers. */
  chainId: number;

  /** Every JSON-RPC call received, in order. */
  readonly calls: { method: string; params: unknown[] }[] = [];
  /** Every transaction accepted, in order. */
  readonly sent: SentTransaction[] = [];

  // ── Knobs: how this node behaves ──────────────────────────────────────────
  gasEstimate = 120_000n;
  baseFee = 1_000_000_000n;
  priorityFee = 500_000_000n;
  /** `eth_estimateGas` answers with this error. */
  estimateFailure: RpcFailure | undefined;
  /** `eth_call` answers with this error instead of `callResult`. */
  callFailure: RpcFailure | undefined;
  callResult: Hex = "0x";
  /** The status transactions are mined with. */
  status: "success" | "reverted" = "success";
  /** Leave `contractAddress` out of a creation's receipt. */
  omitContractAddress = false;
  /** Creations succeed but leave no code behind. */
  emptyCreations = false;
  /** `eth_getTransactionReceipt` answers "not yet" this many times per transaction. */
  receiptDelay = 0;
  /** Never hand out a receipt: the transaction stays pending. */
  neverMine = false;
  /** `eth_getCode` answers "0x" this many times for a contract that was just created. */
  codeDelay = 0;
  /** `eth_getTransactionCount` keeps answering the old count this many times after a transaction. */
  nonceLag = 0;
  /** The whole node is unreachable: every request fails at the network. */
  down = false;
  /** The node is up but answers every request with this HTTP status. */
  httpStatus: number | undefined;
  /** Take the next request for this method, then lose the answer on the way back. */
  loseAnswerTo: string | undefined;

  private readonly overrides = new Map<string, Handler>();
  private readonly balances = new Map<string, bigint>();
  private readonly nonces = new Map<string, number>();
  private readonly code = new Map<string, { code: Hex; hidden: number }>();
  private readonly mined = new Map<Hex, { transaction: SentTransaction; polls: number }>();
  private readonly arriving: { address: string; wei: bigint; reads: number }[] = [];
  private staleNonce: { address: string; count: number; reads: number } | undefined;
  private block = 1_000n;

  constructor(rpcUrl: string, chainId: number) {
    this.url = new URL(rpcUrl).href;
    this.chainId = chainId;
  }

  /** Answer `method` with this handler: return the result, or throw an `RpcFailure`. */
  override(method: string, handler: Handler): void {
    this.overrides.set(method, handler);
  }

  balanceOf(address: string): bigint {
    return this.balances.get(key(address)) ?? 0n;
  }

  setBalance(address: string, wei: bigint): void {
    this.balances.set(key(address), wei);
  }

  /** Credit `wei` once the balance has been read `reads` more times. */
  creditLater(address: string, wei: bigint, reads: number): void {
    if (reads <= 0) this.setBalance(address, this.balanceOf(address) + wei);
    else this.arriving.push({ address: key(address), wei, reads });
  }

  /** Put code at an address, as if a contract had been deployed there earlier. */
  setCode(address: string, code: Hex = RUNTIME_CODE): void {
    this.code.set(key(address), { code, hidden: 0 });
  }

  /** The calls made to one method. */
  callsTo(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.params);
  }

  async handle(init: RequestInit | undefined): Promise<Response> {
    if (this.down) throw new TypeError("fetch failed");
    if (this.httpStatus) return new Response("upstream error", { status: this.httpStatus });
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params?: unknown[];
    };
    const params = request.params ?? [];
    this.calls.push({ method: request.method, params });

    let payload: object;
    try {
      const handler = this.overrides.get(request.method) ?? this.defaults[request.method];
      if (!handler) throw { code: -32601, message: `fake node: no handler for ${request.method}` };
      payload = { jsonrpc: "2.0", id: request.id, result: await handler(params) };
    } catch (error) {
      if (error instanceof Error) throw error;
      payload = { jsonrpc: "2.0", id: request.id, error };
    }
    if (this.loseAnswerTo === request.method) {
      this.loseAnswerTo = undefined;
      throw new TypeError("fetch failed");
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  private readonly defaults: Record<string, Handler> = {
    eth_chainId: () => hex(this.chainId),
    eth_blockNumber: () => hex(this.block),
    eth_gasPrice: () => hex(this.baseFee + this.priorityFee),
    eth_maxPriorityFeePerGas: () => hex(this.priorityFee),
    eth_getBlockByNumber: () => ({
      number: hex(this.block),
      hash: ZERO_HASH,
      parentHash: ZERO_HASH,
      timestamp: hex(1_800_000_000),
      baseFeePerGas: hex(this.baseFee),
      gasLimit: hex(15_000_000),
      gasUsed: hex(0),
      transactions: [],
    }),
    eth_getBalance: ([address]) => {
      for (const credit of this.arriving) {
        if (credit.address !== key(String(address)) || credit.reads <= 0) continue;
        credit.reads -= 1;
        if (credit.reads === 0) {
          this.setBalance(credit.address, this.balanceOf(credit.address) + credit.wei);
        }
      }
      return hex(this.balanceOf(String(address)));
    },
    eth_getTransactionCount: ([address]) => {
      const who = key(String(address));
      if (this.staleNonce?.address === who && this.staleNonce.reads > 0) {
        this.staleNonce.reads -= 1;
        return hex(this.staleNonce.count);
      }
      return hex(this.nonces.get(who) ?? 0);
    },
    eth_getCode: ([address]) => {
      const entry = this.code.get(key(String(address)));
      if (!entry) return "0x";
      if (entry.hidden > 0) {
        entry.hidden -= 1;
        return "0x";
      }
      return entry.code;
    },
    eth_estimateGas: ([request]) => {
      if (this.estimateFailure) throw this.estimateFailure;
      this.requireFunds(request as CallRequest);
      return hex(this.gasEstimate);
    },
    eth_call: ([request]) => {
      if (this.callFailure) throw this.callFailure;
      this.requireFunds(request as CallRequest);
      return this.callResult;
    },
    eth_sendRawTransaction: async ([raw]) => this.accept(raw as Hex),
    eth_getTransactionByHash: ([hash]) => {
      const entry = this.mined.get(hash as Hex);
      if (!entry) return null;
      const { transaction } = entry;
      return {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        nonce: hex(transaction.nonce),
        input: transaction.data,
        value: hex(transaction.value),
      };
    },
    eth_getTransactionReceipt: ([hash]) => {
      const entry = this.mined.get(hash as Hex);
      if (!entry || this.neverMine) return null;
      if (entry.polls < this.receiptDelay) {
        entry.polls += 1;
        return null;
      }
      const { transaction } = entry;
      return {
        transactionHash: transaction.hash,
        transactionIndex: "0x0",
        blockHash: ZERO_HASH,
        blockNumber: hex(this.block),
        from: transaction.from,
        to: transaction.to,
        contractAddress: this.omitContractAddress ? null : transaction.created,
        cumulativeGasUsed: hex(transaction.gas),
        gasUsed: hex(transaction.gas),
        effectiveGasPrice: hex(this.baseFee + this.priorityFee),
        logs: [],
        logsBloom: `0x${"00".repeat(256)}`,
        status: this.status === "success" ? "0x1" : "0x0",
        type: "0x2",
      };
    },
  };

  /**
   * What a node does with a call or an estimate that names a price: it refuses
   * when the sender could not pay that price, or could not send that value. A
   * request with no price in it is not held to the sender's balance — which is
   * what lets an empty wallet be given an estimate at all.
   */
  private requireFunds(request: CallRequest): void {
    const price = request.maxFeePerGas ?? request.gasPrice;
    const value = BigInt(request.value ?? 0);
    const needed = (price ? this.gasEstimate * BigInt(price) : 0n) + value;
    const balance = this.balanceOf(request.from ?? "");
    if (needed > balance) {
      throw {
        code: -32000,
        message: `insufficient funds for gas * price + value: address ${request.from} have ${balance} want ${needed}`,
      };
    }
  }

  /**
   * What a node does with a raw transaction: check it the way a node would, then
   * mine it. Public so that a test's own handler can take one and then misbehave.
   */
  async accept(raw: Hex): Promise<Hex> {
    const hash = keccak256(raw);
    if (this.mined.has(hash)) throw { code: -32000, message: "already known" };

    const parsed = parseTransaction(raw);
    const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
    if (parsed.chainId !== this.chainId) {
      throw {
        code: -32000,
        message: `invalid chain id for signer: have ${parsed.chainId} want ${this.chainId}`,
      };
    }
    const expected = this.nonces.get(key(from)) ?? 0;
    const nonce = parsed.nonce ?? 0;
    if (nonce < expected) throw { code: -32000, message: "nonce too low" };
    if (nonce > expected) throw { code: -32000, message: "nonce too high" };

    const gas = parsed.gas ?? 0n;
    const value = parsed.value ?? 0n;
    const upfront = gas * (parsed.maxFeePerGas ?? 0n) + value;
    if (this.balanceOf(from) < upfront) {
      throw {
        code: -32000,
        message: `insufficient funds for gas * price + value: address ${from} have ${this.balanceOf(from)} want ${upfront}`,
      };
    }

    const created = parsed.to
      ? null
      : (getContractAddress({ from, nonce: BigInt(nonce) }).toLowerCase() as Address);
    const transaction: SentTransaction = {
      hash,
      from,
      to: parsed.to ?? null,
      data: parsed.data ?? "0x",
      value,
      chainId: parsed.chainId,
      nonce,
      gas,
      maxFeePerGas: parsed.maxFeePerGas ?? 0n,
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? 0n,
      type: parsed.type ?? "",
      created,
    };

    this.block += 1n;
    this.sent.push(transaction);
    this.mined.set(hash, { transaction, polls: 0 });
    this.staleNonce = { address: key(from), count: expected, reads: this.nonceLag };
    this.nonces.set(key(from), expected + 1);
    this.setBalance(from, this.balanceOf(from) - gas * (this.baseFee + this.priorityFee) - value);
    if (created && this.status === "success" && !this.emptyCreations) {
      this.code.set(key(created), { code: RUNTIME_CODE, hidden: this.codeDelay });
    }
    return hash;
  }
}

/** One scripted answer of the faucet. */
export type FaucetAnswer =
  /** Fund the address and answer 200. */
  | "fund"
  /** Fail at the network, as an unreachable host does. */
  | "network"
  /** Fail the way a request that ran out of time does. */
  | "timeout"
  /** Fund the address, then lose the answer: the caller sees a network failure. */
  | "fund-then-drop"
  | { status: number; body?: unknown; headers?: Record<string, string> };

export class FakeFaucet {
  /** Where it listens: the hosted faucet's address, unless a test moves it. */
  url = new URL(DEFAULT_FAUCET_URL).href;
  /** The parsed bodies of the requests received, in order. */
  readonly requests: { address?: string; chainId?: number }[] = [];
  /** The `init` each request was made with: method, headers, signal. */
  readonly inits: RequestInit[] = [];
  /** What one drip is worth: 0.02 AVAX, as the hosted faucet's. */
  dripWei = 20_000_000_000_000_000n;
  /** Answers given in order; once they run out, every request is funded. */
  script: FaucetAnswer[] = [];
  /** How many balance reads pass before a drip shows up in the wallet. */
  arrivalDelay = 0;

  constructor(private readonly node: FakeNode) {}

  async handle(init: RequestInit | undefined): Promise<Response> {
    const body = JSON.parse(String(init?.body)) as { address?: string; chainId?: number };
    this.requests.push(body);
    this.inits.push(init ?? {});
    const answer = this.script.shift() ?? "fund";

    if (answer === "network") {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }
    if (answer === "timeout") {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    if (answer === "fund" || answer === "fund-then-drop") {
      this.node.creditLater(String(body.address), this.dripWei, this.arrivalDelay);
      if (answer === "fund-then-drop") throw new TypeError("fetch failed");
      return Response.json({ txHash: `0x${"fa".repeat(32)}`, amount: "0.02", chainId: 43113 });
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  }
}

export interface FakeNetwork {
  fuji: FakeNode;
  cChain: FakeNode;
  faucet: FakeFaucet;
  /** URLs requested that are neither chain nor the faucet. A test expects none. */
  strays: string[];
}

/** Replace `fetch` with a network of two fake chains and a fake faucet. */
export function fakeNetwork(): FakeNetwork {
  const fujiNode = new FakeNode(fuji.rpcUrl, fuji.id);
  const network: FakeNetwork = {
    fuji: fujiNode,
    cChain: new FakeNode(cChain.rpcUrl, cChain.id),
    faucet: new FakeFaucet(fujiNode),
    strays: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? String(input) : input.url,
      ).href;
      if (url === network.fuji.url) return network.fuji.handle(init);
      if (url === network.cChain.url) return network.cChain.handle(init);
      if (url === network.faucet.url) return network.faucet.handle(init);
      network.strays.push(url);
      throw new TypeError("fetch failed");
    }),
  );
  return network;
}

export interface FakeClock {
  /** The current time, which only `sleep` moves. */
  now: number;
  /** Every wait asked for, in order, in milliseconds. */
  sleeps: number[];
}

/**
 * Replace the package's clock, so that a wait takes no time and a test can see
 * how long the code meant to wait. Undo with `vi.restoreAllMocks()`.
 */
export function fakeClock(): FakeClock {
  const state: FakeClock = { now: 1_700_000_000_000, sleeps: [] };
  vi.spyOn(clock, "now").mockImplementation(() => state.now);
  vi.spyOn(clock, "sleep").mockImplementation(async (ms: number) => {
    state.sleeps.push(ms);
    state.now += ms;
  });
  return state;
}
