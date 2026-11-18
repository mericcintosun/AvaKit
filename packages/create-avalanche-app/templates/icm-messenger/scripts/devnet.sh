#!/usr/bin/env bash
#
# One-command local ICM devnet.
#
# Spins up TWO Avalanche L1s (subnet-EVM) with Interchain Messaging (Teleporter)
# and a relayer, all on a local network, then writes the discovered RPC URLs,
# blockchain IDs and TeleporterMessenger address into icm.config.json so the app
# can talk to both chains.
#
# Requires avalanche-cli. It downloads avalanchego + subnet-EVM on first run.

set -uo pipefail

# Blockchain names + EVM chain ids are unique to this template so it can coexist
# with the token-bridge devnet (br1/br2 · 2001/2002) on one machine.
CHAIN1="icm1"
CHAIN2="icm2"
EVM_CHAIN_ID_1=1001
EVM_CHAIN_ID_2=1002
TOKEN_1="TOK1"
TOKEN_2="TOK2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/icm.config.json"
# Where the TeleporterMessenger lives on a chain that uses the canonical
# predeploy. The real address is read from avalanche-cli below; this is only the
# assumption when the CLI does not name one, and it is still checked on-chain.
CANONICAL_TELEPORTER="0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf"

say()  { printf "\033[1;37m▸\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$1" >&2; }
die()  { printf "\033[1;31m✖\033[0m %s\n" "$1" >&2; exit 1; }

# Deploy an L1 to the local network with an actionable error on stale state.
deploy_local() {
  local name="$1"
  avalanche blockchain deploy "$name" --local </dev/null && return 0
  die "Deploy of '$name' failed.
     If it says a blockchain is already deployed, a previous local network is still
     around. Reset it and re-run:
       avalanche network clean && pnpm devnet
     Or wipe automatically on the next run:
       CLEAN=1 pnpm devnet"
}

# --- 0. avalanche-cli present? ---------------------------------------------
if ! command -v avalanche >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✖ avalanche-cli not found. Install it (it bundles nothing else you need):

  curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin

  # or:  brew install ava-labs/tap/avalanche-cli

Then re-run: pnpm devnet
EOF
  exit 1
fi
command -v node >/dev/null 2>&1 || die "node not found (this script uses it to check that ICM is deployed)."

# --- 0b. Opt-in clean slate -------------------------------------------------
# `CLEAN=1 pnpm devnet` wipes any existing local network first. Off by default
# so it never silently destroys unrelated local L1s (e.g. an l1-launch chain).
if [ "${CLEAN:-}" = "1" ]; then
  say "CLEAN=1 → wiping any existing local network…"
  avalanche network clean >/dev/null 2>&1 || true
fi

# --- 1. Create the two L1s (ICM + relayer are on by default) ----------------
create_l1() {
  local name="$1" cid="$2" tok="$3"
  say "Creating L1 '$name' (evm chainId $cid)…"
  avalanche blockchain create "$name" \
    --evm --latest \
    --evm-chain-id "$cid" \
    --evm-token "$tok" \
    --test-defaults \
    --sovereign=false \
    --icm \
    --force </dev/null >/dev/null 2>&1 || die "Failed to create '$name'. Try: avalanche blockchain delete $name"
}
create_l1 "$CHAIN1" "$EVM_CHAIN_ID_1" "$TOKEN_1"
create_l1 "$CHAIN2" "$EVM_CHAIN_ID_2" "$TOKEN_2"

# --- 2. Deploy them to the local network ------------------------------------
# The first deploy boots the local network (C-Chain included) and auto-deploys
# the TeleporterMessenger + configures the relayer for every chain pair.
say "Deploying '$CHAIN1' locally (this also starts the local network)…"
deploy_local "$CHAIN1"
say "Deploying '$CHAIN2' locally…"
deploy_local "$CHAIN2"

# --- 3. Discover each chain's RPC URL, blockchain ID and Teleporter ----------
# `describe` prints all three. We grep by shape (robust across CLI versions):
# the localhost RPC path, a 0x + 64-hex id, and the address on the first
# "ICM Messenger" row.
rpc_of() { printf '%s' "$1" | grep -oE 'http://127\.0\.0\.1:[0-9]+/ext/bc/[A-Za-z0-9]+/rpc' | head -1; }
# The bytes32 blockchain ID lives on the "BlockchainID (HEX)" row.
bid_of() { printf '%s' "$1" | grep -iE 'BlockchainID \(HEX\)' | grep -oiE '0x[0-9a-f]{64}' | head -1; }
teleporter_of() { printf '%s' "$1" | grep -iE 'ICM Messenger' | grep -oE '0x[0-9a-fA-F]{40}' | head -1; }

say "Reading chain details…"
DESC1="$(avalanche blockchain describe "$CHAIN1" 2>/dev/null)"
DESC2="$(avalanche blockchain describe "$CHAIN2" 2>/dev/null)"
RPC1="$(rpc_of "$DESC1")"; BID1="$(bid_of "$DESC1")"
RPC2="$(rpc_of "$DESC2")"; BID2="$(bid_of "$DESC2")"

[ -n "$RPC1" ] && [ -n "$BID1" ] || die "Could not read '$CHAIN1' RPC/blockchain ID. Run: avalanche blockchain describe $CHAIN1"
[ -n "$RPC2" ] && [ -n "$BID2" ] || die "Could not read '$CHAIN2' RPC/blockchain ID. Run: avalanche blockchain describe $CHAIN2"

# --- 4. Find the TeleporterMessenger and make sure it is really there -------
# The messenger contract takes its chain's TeleporterMessenger address as a
# constructor argument, so the app has to be given the real one. A messenger
# deployed against an address with no contract cannot send or receive anything.
teleporter_for() { # <chain name> <describe output>
  local found
  found="$(teleporter_of "$2")"
  if [ -z "$found" ]; then
    warn "avalanche-cli did not name the TeleporterMessenger on '$1' — assuming the canonical predeploy."
    found="$CANONICAL_TELEPORTER"
  fi
  printf '%s' "$found"
}
ICM1="$(teleporter_for "$CHAIN1" "$DESC1")"
ICM2="$(teleporter_for "$CHAIN2" "$DESC2")"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
[ "$(lower "$ICM1")" = "$(lower "$ICM2")" ] || die "The two chains use different TeleporterMessenger addresses
     ($CHAIN1: $ICM1 · $CHAIN2: $ICM2), but the app expects one address for both.
     Rebuild the devnet so both chains run the same ICM version: CLEAN=1 pnpm devnet"

# Is there contract code at address $2 on the chain behind RPC $1?
# Prints "yes", "no", or "unreachable" (the RPC did not answer).
has_code() {
  node -e '
    const [rpc, address] = process.argv.slice(1);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] });
    fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10000),
    })
      .then((response) => response.json())
      .then((json) => {
        if (typeof json.result !== "string") throw new Error("no result");
        console.log(/^0x0*$/.test(json.result) ? "no" : "yes");
      })
      .catch(() => console.log("unreachable"));
  ' "$1" "$2" 2>/dev/null
}
require_teleporter() { # <chain name> <rpc url> <address>
  local answer="" attempt
  for attempt in 1 2 3 4 5; do
    answer="$(has_code "$2" "$3")"
    [ "$answer" = "unreachable" ] || break
    sleep 2
  done
  case "$answer" in
    yes) ;;
    no) die "ICM is not deployed on '$1': there is no contract at the TeleporterMessenger address
     $3 ($2).
     Messages cannot be sent without it. Inspect the chain with: avalanche blockchain describe $1" ;;
    *) warn "Could not reach '$1' at $2 to confirm that ICM is deployed — continuing.
     If the app shows \"ICM —\" on this chain, check the network: avalanche network status" ;;
  esac
}
say "Checking that ICM is deployed on both chains ($ICM1)…"
require_teleporter "$CHAIN1" "$RPC1" "$ICM1"
require_teleporter "$CHAIN2" "$RPC2" "$ICM2"

# --- 5. Write icm.config.json -----------------------------------------------
cat > "$CONFIG" <<EOF
{
  "configured": true,
  "teleporterMessenger": "$ICM1",
  "chain1": { "name": "$CHAIN1", "token": "$TOKEN_1", "evmChainId": $EVM_CHAIN_ID_1, "rpcUrl": "$RPC1", "blockchainIdHex": "$BID1" },
  "chain2": { "name": "$CHAIN2", "token": "$TOKEN_2", "evmChainId": $EVM_CHAIN_ID_2, "rpcUrl": "$RPC2", "blockchainIdHex": "$BID2" }
}
EOF

say "Wrote icm.config.json:"
printf "   %s → %s\n   %s → %s\n" "$CHAIN1" "$RPC1" "$CHAIN2" "$RPC2"

# --- 6. The EWOQ dev key, for the wallet import below -----------------------
# EWOQ is avalanche-cli's public local dev key, pre-funded on both chains. It is
# not written in this repo (secret scanners flag committed keys, even public dev
# ones): avalanche-cli prints it on the "ewoq" row of `blockchain describe`.
EWOQ_KEY="$(printf '%s' "$DESC1" | grep -E '^[^|]*\|[[:space:]]*ewoq[[:space:]]*\|' | grep -oE '[0-9a-fA-F]{64}' | head -1)"
if [ -n "$EWOQ_KEY" ]; then
  EWOQ_HINT="0x$EWOQ_KEY"
else
  EWOQ_HINT="(avalanche-cli shows it on the \"ewoq\" row of: avalanche blockchain describe $CHAIN1)"
fi

cat <<EOF

✔ Local ICM devnet is up.

Next:
  1. In your wallet (Core / MetaMask), import the EWOQ dev key (pre-funded on both chains):
       $EWOQ_HINT
     (public dev key — local devnet only, never a real network)
  2. pnpm dev  →  http://localhost:3000 (or the port Next prints)
  3. Deploy the messenger on both chains, then send a message across.

Stop / reset the devnet:
  avalanche network stop     # pause (keeps state)
  avalanche network clean    # wipe (new blockchain IDs — re-run pnpm devnet)
  CLEAN=1 pnpm devnet        # wipe + rebuild in one step
EOF
