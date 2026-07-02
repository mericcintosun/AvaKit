#!/usr/bin/env bash
#
# One-command local ICM devnet.
#
# Spins up TWO Avalanche L1s (subnet-EVM) with Interchain Messaging (Teleporter)
# and a relayer, all on a local network, then writes the discovered RPC URLs and
# blockchain IDs into icm.config.json so the app can talk to both chains.
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

say() { printf "\033[1;37m▸\033[0m %s\n" "$1"; }
die() { printf "\033[1;31m✖\033[0m %s\n" "$1" >&2; exit 1; }

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

# --- 3. Discover RPC URL + hex blockchain ID for each chain -----------------
# `describe` prints the RPC URL and the blockchain ID in hex. We grep by shape
# (robust across CLI versions): the localhost RPC path, and a 0x + 64-hex id.
discover() {
  local name="$1" out rpc bid
  out="$(avalanche blockchain describe "$name" 2>/dev/null)"
  rpc="$(printf '%s' "$out" | grep -oE 'http://127\.0\.0\.1:[0-9]+/ext/bc/[A-Za-z0-9]+/rpc' | head -1)"
  # The bytes32 blockchain ID lives on the "BlockchainID (HEX)" row.
  bid="$(printf '%s' "$out" | grep -iE 'BlockchainID \(HEX\)' | grep -oiE '0x[0-9a-f]{64}' | head -1)"
  printf '%s\t%s' "$rpc" "$bid"
}
say "Reading chain details…"
IFS=$'\t' read -r RPC1 BID1 < <(discover "$CHAIN1")
IFS=$'\t' read -r RPC2 BID2 < <(discover "$CHAIN2")

[ -n "$RPC1" ] && [ -n "$BID1" ] || die "Could not read '$CHAIN1' RPC/blockchain ID. Run: avalanche blockchain describe $CHAIN1"
[ -n "$RPC2" ] && [ -n "$BID2" ] || die "Could not read '$CHAIN2' RPC/blockchain ID. Run: avalanche blockchain describe $CHAIN2"

# --- 4. Write icm.config.json -----------------------------------------------
cat > "$CONFIG" <<EOF
{
  "configured": true,
  "teleporterMessenger": "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf",
  "chain1": { "name": "$CHAIN1", "token": "$TOKEN_1", "evmChainId": $EVM_CHAIN_ID_1, "rpcUrl": "$RPC1", "blockchainIdHex": "$BID1" },
  "chain2": { "name": "$CHAIN2", "token": "$TOKEN_2", "evmChainId": $EVM_CHAIN_ID_2, "rpcUrl": "$RPC2", "blockchainIdHex": "$BID2" }
}
EOF

say "Wrote icm.config.json:"
printf "   %s → %s\n   %s → %s\n" "$CHAIN1" "$RPC1" "$CHAIN2" "$RPC2"
cat <<EOF

✔ Local ICM devnet is up.

Next:
  1. In your wallet (Core / MetaMask), import the EWOQ dev key (pre-funded on both chains):
       0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
  2. pnpm dev  →  http://localhost:3000
  3. Deploy the messenger on both chains, then send a message across.

Stop / reset the devnet:
  avalanche network stop     # pause (keeps state)
  avalanche network clean    # wipe (new blockchain IDs — re-run pnpm devnet)
  CLEAN=1 pnpm devnet        # wipe + rebuild in one step
EOF
