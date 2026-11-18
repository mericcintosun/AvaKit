#!/usr/bin/env bash
#
# Graduate your L1 to the Fuji TESTNET (advanced).
#
# Unlike `npm run l1` (fully local, instant, free), deploying to Fuji is a real,
# multi-step operation. This script wraps the avalanche-cli commands and, where
# the CLI needs interactive input or your own keys, walks you through it. Read
# the caveats below before running — a Fuji L1 needs an always-on validator and
# a periodically-topped-up balance, or it stops producing blocks.
#
# The local chain from `npm run l1` never goes to Fuji: it is a non-sovereign dev
# chain whose genesis pre-funds the PUBLIC EWOQ key. This script creates a
# separate avalanche-cli config instead — a sovereign Proof-of-Authority L1 with
# production defaults, owned by your Fuji key, with the same chain ID and token
# as your local chain — and deploys that. It never overwrites an existing config.
#
# Configure via env (only FUJI_KEY is required):
#   FUJI_KEY=mykey npm run l1:fuji
#
#   FUJI_KEY              avalanche-cli key that pays for the deploy and owns the L1
#   L1_NAME               your local chain's name (default: the one in l1.config.json)
#   L1_FUJI_NAME          avalanche-cli name of the Fuji L1 (default: <L1_NAME>fuji)
#   L1_CHAIN_ID           EVM chain ID (default: the one in l1.config.json)
#   L1_TOKEN              native token symbol (default: the one in l1.config.json)
#   L1_OWNER              Validator Manager owner address (default: FUJI_KEY's address)
#   L1_VALIDATOR_BALANCE  AVAX the bootstrap validator starts with (default: 0.1)

set -uo pipefail

KEY="${FUJI_KEY:-}"
BALANCE="${L1_VALIDATOR_BALANCE:-0.1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/l1.config.json"
CLI_HOME="$HOME/.avalanche-cli"

say()  { printf "\033[1;37m▸\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$1"; }
die()  { printf "\033[1;31m✖\033[0m %s\n" "$1" >&2; exit 1; }

command -v avalanche >/dev/null 2>&1 || die "avalanche-cli not found. See CLAUDE.md."
command -v node >/dev/null 2>&1 || die "node not found (this script reads JSON with it)."

cat <<'EOF'
────────────────────────────────────────────────────────────────────────
Deploy your L1 to Fuji — what you need first (one-time):

  1. A Fuji key funded with test AVAX:
       avalanche key create mykey            # creates a key
       # fund its C-Chain address from the official faucet (needs a free Builder Hub
       # sign-in):
       #   https://build.avax.network/console/primary-network/faucet
       # then move funds to the P-Chain (the deploy spends from there; keep a
       # little on the C-Chain for the transfer fee):
       avalanche key transfer --key mykey --fuji --c-chain-sender --p-chain-receiver --amount 1

  2. Budget ~1-2 test AVAX PER validator — an L1 validator pays a continuous
     P-Chain fee (~1 AVAX ≈ 1 month). When the balance hits zero the validator
     goes inactive and your L1 STOPS. Check it and top it up with:
       avalanche validator getBalance --fuji --l1 <name>
       avalanche validator increaseBalance --fuji --l1 <name> --key mykey --balance 1

  3. A bootstrap validator node that STAYS RUNNING. Your machine can be it
     (--use-local-machine below), but if this process exits, block production
     stops. For an always-on chain, run a real node instead.
────────────────────────────────────────────────────────────────────────
EOF

[ -n "$KEY" ] || die "Set FUJI_KEY to your funded avalanche-cli key name, e.g. FUJI_KEY=mykey npm run l1:fuji"
case "$KEY" in
  *[!A-Za-z0-9_-]*) die "FUJI_KEY must be the NAME of an avalanche-cli key (see: avalanche key list), not a key or a path." ;;
esac
[ -f "$CLI_HOME/key/$KEY.pk" ] || die "No avalanche-cli key named '$KEY'. Create one first: avalanche key create $KEY"

# --- 1. Work out which chain this is -----------------------------------------
# Defaults come from what `npm run l1` wrote, so the Fuji L1 keeps your chain ID and
# token without retyping them.
IFS='|' read -r CFG_NETWORK CFG_NAME CFG_CHAIN_ID CFG_TOKEN < <(
  node -e '
    let config = {};
    try {
      config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    } catch {}
    const clean = (value) => String(value ?? "").replace(/[^A-Za-z0-9]/g, "");
    const fields = [config.network, config.name, config.evmChainId, config.token];
    process.stdout.write(`${fields.map(clean).join("|")}\n`);
  ' "$CONFIG"
)

if [ -n "${L1_FUJI_NAME:-}" ]; then
  NAME="$L1_FUJI_NAME"
elif [ -n "${L1_NAME:-}" ]; then
  NAME="${L1_NAME}fuji"
elif [ "$CFG_NETWORK" = "fuji" ] && [ -n "$CFG_NAME" ]; then
  NAME="$CFG_NAME"            # this app already points at a Fuji L1: keep using it
else
  NAME="${CFG_NAME:-mychain}fuji"
fi
CHAIN_ID="${L1_CHAIN_ID:-${CFG_CHAIN_ID:-9999}}"
TOKEN="${L1_TOKEN:-${CFG_TOKEN:-MYL1}}"

case "$NAME" in
  ""|*[!A-Za-z0-9]*) die "The L1 name '$NAME' may only contain letters and digits." ;;
esac
case "$CHAIN_ID" in
  ""|*[!0-9]*) die "L1_CHAIN_ID must be a positive integer (got '$CHAIN_ID')." ;;
esac
case "$TOKEN" in
  ""|*[!A-Za-z0-9]*) die "L1_TOKEN may only contain letters and digits (got '$TOKEN')." ;;
esac
[[ "$BALANCE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "L1_VALIDATOR_BALANCE must be an amount of AVAX such as 0.5 (got '$BALANCE')."

# What avalanche-cli knows about a blockchain config, read from its own files
# (sidecar.json + genesis.json) rather than scraped from a table.
# Prints: state|evmChainId|token|rpcUrl|blockchainIdHex
#   missing  no config with this name
#   test     non-sovereign and/or pre-funds the public EWOQ key — what `npm run l1` creates
#   ready    sovereign, not on Fuji yet
#   partial  a Fuji deploy was started but recorded no RPC endpoint
#   live     deployed to Fuji
inspect_l1() {
  node - "$CLI_HOME/subnets/$1" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const dir = process.argv[2];
const read = (file) => {
  try {
    return JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch {
    return null;
  }
};
const sidecar = read("sidecar.json");
const genesis = read("genesis.json");

// The address of avalanche-cli's public local dev key. A genesis that funds it
// is a dev chain, whatever else the config says.
const EWOQ = "8db97c7cece249c2b98bdc0226cc4c2a57bf52fc";
const fundsEwoq = Object.keys(genesis?.alloc ?? {}).some(
  (address) => address.replace(/^0x/i, "").toLowerCase() === EWOQ,
);

// Blockchain IDs are stored as CB58: base58(32-byte id + 4-byte sha256 checksum).
function cb58ToHex(id) {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of String(id ?? "")) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return "";
    value = value * 58n + BigInt(digit);
  }
  const hex = value.toString(16).padStart(72, "0");
  if (hex.length !== 72) return "";
  const body = hex.slice(0, 64);
  const checksum = createHash("sha256").update(Buffer.from(body, "hex")).digest("hex").slice(-8);
  return checksum === hex.slice(64) ? `0x${body}` : "";
}

const networks = Object.entries(sidecar?.Networks ?? {});
const fuji = networks.find(([name]) => /^fuji/i.test(name))?.[1];
const rpcUrl = fuji?.RPCEndpoints?.[0] ?? "";

let state = "missing";
if (sidecar) {
  if (sidecar.Sovereign !== true || fundsEwoq) state = "test";
  else if (fuji?.BlockchainID && rpcUrl) state = "live";
  else if (fuji) state = "partial";
  else state = "ready";
}

const clean = (value) => String(value ?? "").replace(/[|\s"\\]/g, "");
const fields = [state, genesis?.config?.chainId, sidecar?.TokenSymbol, rpcUrl, cb58ToHex(fuji?.BlockchainID)];
process.stdout.write(`${fields.map(clean).join("|")}\n`);
NODE
}
read_l1() {
  IFS='|' read -r STATE CUR_CHAIN_ID CUR_TOKEN RPC BID < <(inspect_l1 "$NAME")
}

# The Validator Manager owner: by default your Fuji key's own address, derived
# locally from the key avalanche-cli stores. Only the address is ever printed.
owner_address() {
  ( cd "$ROOT" && node -e '
      const { readFileSync } = require("node:fs");
      const { privateKeyToAccount } = require("viem/accounts");
      const hex = readFileSync(process.argv[1], "utf8").trim().replace(/^0x/, "");
      process.stdout.write(privateKeyToAccount(`0x${hex}`).address);
    ' "$CLI_HOME/key/$KEY.pk" 2>/dev/null )
}

# --- 2. Create the sovereign config, unless one is already there --------------
read_l1
case "${STATE:-}" in
  test)
    die "'$NAME' is a local dev chain config (non-sovereign, or with the public EWOQ key pre-funded
     in its genesis) and must never be deployed to a public network.
     Leave L1_FUJI_NAME unset to use a separate Fuji config, or choose another name."
    ;;
  missing)
    OWNER="${L1_OWNER:-}"
    [ -n "$OWNER" ] || OWNER="$(owner_address)"
    [[ "$OWNER" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "Could not work out the address of key '$KEY' (is this app installed? run: npm install).
     Or pass the owner explicitly — the key's C-Chain address from 'avalanche key list --fuji --keys $KEY':
       L1_OWNER=0x… FUJI_KEY=$KEY npm run l1:fuji"
    say "Creating '$NAME' — a sovereign Proof-of-Authority L1 (chainId $CHAIN_ID · token $TOKEN · owner $OWNER)…"
    # --proof-of-authority + the two owner flags make this a sovereign L1 whose
    # validator set you manage; --production-defaults leaves the EWOQ dev key out
    # of the genesis. CLAUDE.md explains each choice.
    avalanche blockchain create "$NAME" \
      --evm --latest \
      --evm-chain-id "$CHAIN_ID" \
      --evm-token "$TOKEN" \
      --proof-of-authority \
      --validator-manager-owner "$OWNER" \
      --proxy-contract-owner "$OWNER" \
      --production-defaults \
      || die "Could not create '$NAME'. Address the CLI's output above and re-run."
    read_l1
    [ "${STATE:-}" = "ready" ] || die "avalanche-cli created '$NAME', but not as a sovereign L1 without the EWOQ dev allocation
     (state: ${STATE:-unknown}). Refusing to deploy it. Inspect it with: avalanche blockchain describe $NAME"
    ;;
  ready)
    say "Using the existing sovereign config '$NAME' (chainId $CUR_CHAIN_ID · token $CUR_TOKEN)."
    ;;
  partial)
    say "'$NAME' has an unfinished Fuji deploy — picking it up where it stopped."
    ;;
  live)
    say "'$NAME' is already deployed to Fuji — pointing this app at it."
    ;;
  *)
    die "Could not read avalanche-cli's record of '$NAME' ($CLI_HOME/subnets/$NAME)."
    ;;
esac
if { [ -n "${L1_CHAIN_ID:-}" ] && [ "$L1_CHAIN_ID" != "$CUR_CHAIN_ID" ]; } ||
   { [ -n "${L1_TOKEN:-}" ] && [ "$L1_TOKEN" != "$CUR_TOKEN" ]; }; then
  warn "L1_CHAIN_ID / L1_TOKEN are ignored: '$NAME' already exists (chainId $CUR_CHAIN_ID · token $CUR_TOKEN)."
  if [ "$STATE" = "ready" ]; then
    warn "To rebuild it with other settings, first run: avalanche blockchain delete $NAME"
  else
    warn "A chain that is on Fuji keeps its ID and token — set L1_FUJI_NAME to launch a different one."
  fi
fi

# --- 3. Deploy it to Fuji -----------------------------------------------------
if [ "$STATE" != "live" ]; then
  say "Deploying '$NAME' to Fuji with key '$KEY' (your machine as bootstrap validator, $BALANCE AVAX balance)…"
  warn "This is interactive: the CLI may ask you to confirm steps of the CreateSubnet / CreateChain /"
  warn "ConvertSubnetToL1 sequence and whether to fund a relayer (optional). Follow its prompts."
  warn "The node first syncs with Fuji, which takes several minutes — that wait is normal."

  # --use-local-machine turns this machine into the bootstrap validator; the CLI
  # handles subnet creation, chain creation, and conversion to a sovereign L1.
  # --vmc-L1 deploys the Validator Manager on the L1 itself.
  avalanche blockchain deploy "$NAME" \
    --fuji \
    --key "$KEY" \
    --use-local-machine \
    --num-bootstrap-validators 1 \
    --balance "$BALANCE" \
    --vmc-L1 \
    || die "Fuji deploy did not complete. Re-run after addressing the CLI's output."
  read_l1
fi

# --- 4. Point the app at the Fuji L1 ------------------------------------------
[ "${STATE:-}" = "live" ] && [[ "$RPC" =~ ^https?://[^[:space:]]+$ ]] \
  || die "Could not read the Fuji RPC of '$NAME'. Run: avalanche blockchain describe $NAME"
[ -n "$CUR_CHAIN_ID" ] && [ -n "$CUR_TOKEN" ] \
  || die "Could not read the chain ID and token of '$NAME'. Run: avalanche blockchain describe $NAME"

cat > "$CONFIG" <<EOF
{
  "configured": true,
  "network": "fuji",
  "name": "$NAME",
  "token": "$CUR_TOKEN",
  "evmChainId": $CUR_CHAIN_ID,
  "rpcUrl": "$RPC",
  "blockchainIdHex": "${BID:-}",
  "faucetAccount": { "address": "" }
}
EOF

say "Updated l1.config.json → $RPC (network: fuji)"
cat <<EOF

✔ Your L1 '$NAME' is on Fuji.

  • npm run dev → the built-in explorer now points at your Fuji L1's RPC.
  • Connect your OWN funded wallet (no EWOQ on Fuji). The owner address starts
    with native tokens on the L1 for gas.
  • Keep this machine / your validator node running, and keep the validator
    balance topped up, or the L1 stops producing blocks (at ~1 AVAX a month,
    0.1 AVAX lasts about three days):
      avalanche validator getBalance --fuji --l1 $NAME
      avalanche validator increaseBalance --fuji --l1 $NAME --key $KEY --balance 1
  • Back to the local chain any time with: npm run l1

There is no automatic hosted explorer for a custom Fuji L1 — this app's built-in
explorer is your window into the chain.
EOF
