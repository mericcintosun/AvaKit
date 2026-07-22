#!/usr/bin/env bash
#
# Launch your own local Avalanche L1 — one command.
#
# Creates a Subnet-EVM blockchain and deploys it to a local Avalanche network,
# then writes the discovered RPC URL + blockchain ID into l1.config.json so the
# app can talk to your chain. Everything runs on your machine — no test AVAX, no
# faucet, no always-on node. To graduate the same chain to the Fuji testnet, see
# `pnpm l1:fuji` (scripts/l1-fuji.sh) and CLAUDE.md.
#
# Configure via env (all optional):
#   L1_NAME=mychain L1_CHAIN_ID=9999 L1_TOKEN=MYL1 pnpm l1
#
# Requires avalanche-cli. It downloads avalanchego + Subnet-EVM on first run.

set -uo pipefail

NAME="${L1_NAME:-mychain}"
CHAIN_ID="${L1_CHAIN_ID:-9999}"
TOKEN="${L1_TOKEN:-MYL1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/l1.config.json"

# EWOQ: avalanche-cli's well-known local dev key, pre-funded on every local
# chain. PUBLIC — for local networks only, never a real network. Import it into
# your wallet to transact on your L1.
EWOQ_PK="0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"
EWOQ_ADDR="0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC"

say() { printf "\033[1;37m▸\033[0m %s\n" "$1"; }
die() { printf "\033[1;31m✖\033[0m %s\n" "$1" >&2; exit 1; }

# Deploy the L1 to the local network with an actionable error on stale state.
deploy_local() {
  local name="$1"
  avalanche blockchain deploy "$name" --local </dev/null && return 0
  die "Deploy of '$name' failed.
     If it says a blockchain is already deployed, a previous local network is still
     around. Reset it and re-run:
       avalanche network clean && pnpm l1
     Or wipe automatically on the next run:
       CLEAN=1 pnpm l1"
}

# --- 0. avalanche-cli present? ---------------------------------------------
if ! command -v avalanche >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✖ avalanche-cli not found. Install it:

  curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin

  # or:  brew install ava-labs/tap/avalanche-cli

Then re-run: pnpm l1
EOF
  exit 1
fi

# --- 0b. Opt-in clean slate -------------------------------------------------
# `CLEAN=1 pnpm l1` wipes any existing local network first. Off by default so it
# never silently destroys unrelated local L1s (e.g. an icm-messenger devnet).
if [ "${CLEAN:-}" = "1" ]; then
  say "CLEAN=1 → wiping any existing local network…"
  avalanche network clean >/dev/null 2>&1 || true
fi

# --- 1. Create the L1 -------------------------------------------------------
# --sovereign=false keeps this fully non-interactive for local dev (a true
# sovereign L1 prompts for a validator-manager owner). --test-defaults uses
# local dev settings (EWOQ pre-funded, fast finality). CLAUDE.md explains each
# knob (VM, consensus, chain ID, sovereignty) and the Fuji path uses a real
# sovereign L1.
say "Creating L1 '$NAME' (Subnet-EVM · chainId $CHAIN_ID · token $TOKEN)…"
avalanche blockchain create "$NAME" \
  --evm --latest \
  --evm-chain-id "$CHAIN_ID" \
  --evm-token "$TOKEN" \
  --test-defaults \
  --sovereign=false \
  --force </dev/null >/dev/null 2>&1 \
  || die "Failed to create '$NAME'. Try: avalanche blockchain delete $NAME"

# --- 2. Deploy it to a local network ----------------------------------------
say "Deploying '$NAME' locally (first run boots the local network)…"
deploy_local "$NAME"

# --- 3. Discover RPC URL + hex blockchain ID --------------------------------
# `describe` prints both. We grep by shape (robust across CLI versions).
say "Reading chain details…"
OUT="$(avalanche blockchain describe "$NAME" 2>/dev/null)"
RPC="$(printf '%s' "$OUT" | grep -oE 'http://127\.0\.0\.1:[0-9]+/ext/bc/[A-Za-z0-9]+/rpc' | head -1)"
BID="$(printf '%s' "$OUT" | grep -iE 'BlockchainID \(HEX\)' | grep -oiE '0x[0-9a-f]{64}' | head -1)"

[ -n "$RPC" ] || die "Could not read '$NAME' RPC. Run: avalanche blockchain describe $NAME"

# --- 4. Write l1.config.json ------------------------------------------------
cat > "$CONFIG" <<EOF
{
  "configured": true,
  "network": "local",
  "name": "$NAME",
  "token": "$TOKEN",
  "evmChainId": $CHAIN_ID,
  "rpcUrl": "$RPC",
  "blockchainIdHex": "${BID:-}",
  "faucetAccount": { "note": "EWOQ: avalanche-cli's PUBLIC local dev key, pre-funded on every local network. The key itself is printed by pnpm l1 (never written to this file - secret scanners flag committed keys, even public dev ones).", "address": "$EWOQ_ADDR" }
}
EOF

say "Wrote l1.config.json → $RPC"
cat <<EOF

✔ Your L1 is live locally.

Next:
  1. Import the EWOQ dev key into your wallet (Core / MetaMask) — pre-funded on your chain:
       $EWOQ_PK
     (public dev key, local only)
  2. pnpm dev  →  http://localhost:3000 (or the port Next prints)  (your chain dashboard + explorer)
  3. Deploy the demo token, watch blocks and transactions land in real time.

Manage the network:
  avalanche network stop     # pause (keeps state)
  avalanche network clean    # wipe (new blockchain ID — re-run pnpm l1)
  CLEAN=1 pnpm l1            # wipe + rebuild in one step

Graduate to the Fuji testnet (advanced, needs test AVAX + an always-on node):
  pnpm l1:fuji
EOF
