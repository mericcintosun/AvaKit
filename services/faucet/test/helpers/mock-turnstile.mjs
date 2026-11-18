import { createServer } from "node:http";

/**
 * A stand-in for Cloudflare's Turnstile siteverify endpoint, answering the way
 * the real one does: a token is good once, and only with the right secret.
 */
export async function startMockTurnstile({ secret, goodTokens = [] }) {
  const unspent = new Set(goodTokens);

  const turnstile = {
    /** Every verification the Worker asked for, oldest first. */
    requests: [],
    /** true makes every request fail with a 500, as during an outage. */
    down: false,
    /** Mint another token that will verify once. */
    issue(token) {
      unspent.add(token);
      return token;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    turnstile.requests.push(body);

    if (turnstile.down) {
      res.writeHead(500).end("outage");
      return;
    }

    let outcome;
    if (body.secret !== secret) {
      outcome = { success: false, "error-codes": ["invalid-input-secret"] };
    } else if (unspent.delete(body.response)) {
      outcome = { success: true, "error-codes": [] };
    } else {
      outcome = { success: false, "error-codes": ["timeout-or-duplicate"] };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(outcome));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  turnstile.url = `http://127.0.0.1:${server.address().port}/turnstile/v0/siteverify`;
  return turnstile;
}
