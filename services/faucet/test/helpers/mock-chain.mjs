import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { keccak256, parseTransaction, recoverTransactionAddress, toHex } from "viem";

export const CHAIN_ID = 43113;

/**
 * A stand-in for a Fuji RPC node. It answers just enough JSON-RPC for viem to
 * prepare and send a value transfer, and its transaction pool rejects nonce
 * conflicts with the same messages geth (and so Avalanche's coreth) uses.
 * Nothing here ever reaches a real network.
 *
 * Knobs a test can turn:
 *  - `balance`   wei the faucet account holds
 *  - `delay`     ms to hold every response, so concurrent requests overlap —
 *                a number, or a function of the JSON-RPC method
 *  - `lag`       how many transactions behind `eth_getTransactionCount` answers
 *  - `autoMine`  false keeps accepted transactions pending until `mine()`
 *  - `chainId`   the chain this node is on (anything but Fuji is a wrong RPC)
 *  - `fills`     true makes it answer `eth_fillTransaction`, as geth does
 *  - `blind`     how many lookups of a transaction it holds still answer "not
 *                found", as from a node that has not heard of it yet
 *  - `fail()`    make the next calls of one method fail
 *  - `lose()`    handle the next calls of one method, then lose the answer
 *  - `contract()` make a recipient a contract: costlier to pay, or reverting
 *  - `drop()`    evict a pending transaction, as a restarting node would
 */
export async function startMockChain({ balance = 10n ** 18n, nonce = 7 } = {}) {
  /** address → { nonce: next nonce in state, pool: Map<nonce, hash> } */
  const accounts = new Map();
  const failures = [];
  /** hash → what `eth_getTransactionByHash` answers for a transaction the pool took. */
  const transactions = new Map();
  /** lower-cased recipient → { gas?, reverts? } for recipients that run code. */
  const contracts = new Map();

  const accountOf = (address) => {
    const key = address.toLowerCase();
    if (!accounts.has(key)) accounts.set(key, { nonce, pool: new Map() });
    return accounts.get(key);
  };

  /** What `eth_getTransactionCount(…, "pending")` reports: state plus the executable pool. */
  const pendingCount = (account) => {
    let next = account.nonce;
    while (account.pool.has(next)) next += 1;
    return next;
  };

  const chain = {
    balance,
    delay: 0,
    lag: 0,
    autoMine: true,
    chainId: CHAIN_ID,
    fills: false,
    blind: 0,
    /** Every transaction the pool accepted, oldest first. */
    accepted: [],
    /** The chain id of every signed transaction it was sent, accepted or not. */
    signedFor: [],
    /** Every JSON-RPC method called, oldest first. */
    calls: [],

    /** How many times `method` was called. */
    count(method) {
      return chain.calls.filter((m) => m === method).length;
    },

    /**
     * Fail the next `times` calls of `method`: with an HTTP status (the body is
     * not JSON, as from a broken upstream) or with a JSON-RPC `error`.
     */
    fail(method, { times = 1, status, error } = {}) {
      failures.push({ method, times, status: status ?? (error ? undefined : 500), error });
    },

    /**
     * Handle the next `times` calls of `method` as usual, then lose the answer:
     * the caller gets an HTTP error (a 502, as from a proxy whose upstream hung
     * up) for a call that did happen — or, with `hangUp`, no answer at all,
     * because the connection is dropped.
     */
    lose(method, { times = 1, status = 502, hangUp = false } = {}) {
      failures.push({ method, times, status, lost: true, hangUp });
    },

    /**
     * Put code at `address`. A transfer to it is estimated at `gas`, or, with
     * `reverts` (true, or a reason), is refused by the contract.
     */
    contract(address, { gas, reverts } = {}) {
      contracts.set(address.toLowerCase(), { gas, reverts });
    },

    /** Include every pending transaction that is next in line. */
    mine() {
      for (const account of accounts.values()) {
        while (account.pool.has(account.nonce)) {
          account.pool.delete(account.nonce);
          account.nonce += 1;
        }
      }
    },

    /** Evict `address`'s pending transaction at `txNonce` without mining it. */
    drop(address, txNonce) {
      const { pool } = accountOf(address);
      transactions.delete(pool.get(txNonce));
      pool.delete(txNonce);
    },

    /** The next nonce `address` has in state (mined transactions only). */
    nonceOf(address) {
      return accountOf(address).nonce;
    },

    /** Forget every knob and recording, keeping account state. */
    reset() {
      chain.delay = 0;
      chain.lag = 0;
      chain.autoMine = true;
      chain.chainId = CHAIN_ID;
      chain.fills = false;
      chain.blind = 0;
      contracts.clear();
      chain.accepted.length = 0;
      chain.signedFor.length = 0;
      chain.calls.length = 0;
      failures.length = 0;
    },

    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  async function sendRawTransaction(raw) {
    const tx = parseTransaction(raw);
    chain.signedFor.push(tx.chainId);
    if (tx.chainId !== chain.chainId) {
      throw rpcError(`invalid chain id for signer: have ${tx.chainId} want ${chain.chainId}`);
    }

    const from = await recoverTransactionAddress({ serializedTransaction: raw });
    const account = accountOf(from);
    const hash = keccak256(raw);

    if (account.pool.get(tx.nonce) === hash) throw rpcError("already known");
    if (tx.nonce < account.nonce) {
      throw rpcError(`nonce too low: next nonce ${account.nonce}, tx nonce ${tx.nonce}`);
    }
    if (account.pool.has(tx.nonce)) throw rpcError("replacement transaction underpriced");

    const cost = (tx.value ?? 0n) + (tx.gas ?? 0n) * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n);
    if (chain.balance < cost) throw rpcError("insufficient funds for gas * price + value");

    account.pool.set(tx.nonce, hash);
    transactions.set(hash, {
      hash,
      from,
      to: tx.to,
      nonce: toHex(tx.nonce),
      value: toHex(tx.value ?? 0n),
      input: "0x",
    });
    chain.balance -= tx.value ?? 0n;
    chain.accepted.push({ hash, raw, from, to: tx.to, value: tx.value ?? 0n, nonce: tx.nonce });
    if (chain.autoMine) chain.mine();
    return hash;
  }

  /** What a transfer to `to` is estimated at. Throws if the recipient refuses it. */
  function gasFor(to) {
    const contract = contracts.get(String(to ?? "").toLowerCase());
    if (contract?.reverts) {
      const reason = typeof contract.reverts === "string" ? `: ${contract.reverts}` : "";
      throw rpcError(`execution reverted${reason}`, 3);
    }
    return toHex(contract?.gas ?? 21000);
  }

  async function call({ method, params = [] }) {
    chain.calls.push(method);
    switch (method) {
      case "eth_chainId":
        return toHex(chain.chainId);
      case "eth_fillTransaction": {
        if (!chain.fills) throw unavailable(method);
        // geth completes the transaction with its own chain id, nonce and fees.
        const [tx] = params;
        if (chain.balance < BigInt(tx.value ?? 0))
          throw rpcError("insufficient funds for transfer");
        return {
          raw: "0x",
          tx: {
            type: "0x2",
            chainId: toHex(chain.chainId),
            nonce: toHex(pendingCount(accountOf(tx.from))),
            from: tx.from,
            to: tx.to,
            value: tx.value ?? "0x0",
            input: "0x",
            gas: gasFor(tx.to),
            maxFeePerGas: toHex(5),
            maxPriorityFeePerGas: toHex(1),
            accessList: [],
          },
        };
      }
      case "eth_getBalance":
        return toHex(chain.balance);
      case "eth_getTransactionCount": {
        const account = accountOf(params[0]);
        const count = params[1] === "pending" ? pendingCount(account) : account.nonce;
        return toHex(Math.max(0, count - chain.lag));
      }
      case "eth_estimateGas":
        if (chain.balance < BigInt(params[0]?.value ?? 0)) {
          throw rpcError("insufficient funds for transfer");
        }
        return gasFor(params[0]?.to);
      case "eth_maxPriorityFeePerGas":
        return toHex(1);
      case "eth_gasPrice":
        return toHex(2);
      case "eth_getBlockByNumber":
        return {
          number: toHex(1),
          hash: `0x${"11".repeat(32)}`,
          timestamp: toHex(1),
          gasLimit: toHex(30_000_000),
          gasUsed: toHex(0),
          baseFeePerGas: toHex(2),
          transactions: [],
        };
      case "eth_sendRawTransaction":
        return sendRawTransaction(params[0]);
      case "eth_getTransactionByHash": {
        const known = transactions.get(params[0]);
        if (known && chain.blind > 0) {
          chain.blind -= 1;
          return null;
        }
        return known ?? null;
      }
      default:
        throw unavailable(method);
    }
  }

  const delayFor = (method) =>
    typeof chain.delay === "function" ? chain.delay(method) : chain.delay;

  async function answer(request) {
    const failure = failures.find((f) => f.method === request.method && f.times > 0);
    if (failure) {
      failure.times -= 1;
      if (failure.lost) {
        // The call happens; only its answer goes missing.
        await call(request).catch(() => {});
        return { status: failure.status, hangUp: failure.hangUp };
      }
      chain.calls.push(request.method);
      if (failure.status) return { status: failure.status };
      return { jsonrpc: "2.0", id: request.id, error: failure.error };
    }
    try {
      return { jsonrpc: "2.0", id: request.id, result: await call(request) };
    } catch (e) {
      if (!e.rpc) throw e;
      return { jsonrpc: "2.0", id: request.id, error: e.rpc };
    }
  }

  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    try {
      const body = JSON.parse(text);
      const requests = Array.isArray(body) ? body : [body];
      const replies = await Promise.all(requests.map(answer));
      const delay = Math.max(...requests.map(({ method }) => delayFor(method)));
      if (delay > 0) await sleep(delay);

      const broken = replies.find((reply) => reply.status);
      if (broken?.hangUp) {
        req.socket.destroy();
        return;
      }
      if (broken) {
        res.writeHead(broken.status, { "content-type": "text/plain" });
        res.end("upstream boom");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`mock chain error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  /** An RPC URL shaped like a keyed provider endpoint, to prove nothing leaks it. */
  chain.url = `http://127.0.0.1:${server.address().port}/v3/SECRETPATHKEY0123456789/rpc?apikey=SECRETQUERYKEY0123456789`;
  return chain;
}

function rpcError(message, code = -32000) {
  const error = new Error(message);
  error.rpc = { code, message };
  return error;
}

function unavailable(method) {
  return rpcError(`the method ${method} does not exist/is not available`, -32601);
}
