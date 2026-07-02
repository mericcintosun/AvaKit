#!/usr/bin/env bash
#
# Graduate your L1 to the Fuji TESTNET (advanced).
#
# Unlike `pnpm l1` (fully local, instant, free), deploying to Fuji is a real,
# multi-step operation. This script wraps the avalanche-cli commands and, where
# the CLI needs interactive input or your own keys, walks you through it. Read
# the caveats below before running — a Fuji L1 needs an always-on validator and
# a periodically-topped-up balance, or it stops producing blocks.
#
# Configure via env (all optional; must match the chain you created with pnpm l1):
#   L1_NAME=mychain FUJI_KEY=mykey pnpm l1:fuji

set -uo pipefail

NAME="${L1_NAME:-mychain}"
KEY="${FUJI_KEY:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/l1.config.json"

say()  { printf "\033[1;37m▸\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$1"; }
die()  { printf "\033[1;31m✖\033[0m %s\n" "$1" >&2; exit 1; }

command -v avalanche >/dev/null 2>&1 || die "avalanche-cli not found. See CLAUDE.md."

cat <<'EOF'
────────────────────────────────────────────────────────────────────────
Deploy your L1 to Fuji — what you need first (one-time):

  1. A Fuji key funded with test AVAX:
       avalanche key create mykey            # creates a key
       # fund its C-Chain address from the Builder Hub faucet:
       #   https://build.avax.network/console/primary-network/faucet
       # then move funds to the P-Chain:
       avalanche key transfer --key mykey --amount 2 --sender-blockchain c --receiver-blockchain p

  2. Budget ~1-2 test AVAX PER validator — an L1 validator pays a continuous
     P-Chain fee (~1 AVAX ≈ 1 month). When the balance hits zero the validator
     goes inactive and your L1 STOPS. Top up with:
       avalanche blockchain addValidator / IncreaseL1ValidatorBalance

  3. A bootstrap validator node that STAYS RUNNING. Your machine can be it
     (--use-local-machine below), but if this process exits, block production
     stops. For an always-on chain, run a real node instead.
────────────────────────────────────────────────────────────────────────
EOF

[ -n "$KEY" ] || die "Set FUJI_KEY to your funded avalanche-cli key name, e.g. FUJI_KEY=mykey pnpm l1:fuji"

say "Deploying '$NAME' to Fuji with key '$KEY' (your machine as bootstrap validator)…"
warn "This is interactive: the CLI will ask you to confirm the CreateSubnet / CreateChain /"
warn "ConvertSubnetToL1 transactions and to set up the local-machine validator. Follow its prompts."

# --use-local-machine turns this machine into the bootstrap validator; the CLI
# handles subnet creation, chain creation, and conversion to a sovereign L1.
avalanche blockchain deploy "$NAME" \
  --fuji \
  --key "$KEY" \
  --use-local-machine \
  || die "Fuji deploy did not complete. Re-run after addressing the CLI's output."

# Discover the Fuji RPC + hex blockchain ID for the deployed L1.
say "Reading Fuji chain details…"
OUT="$(avalanche blockchain describe "$NAME" 2>/dev/null)"
RPC="$(printf '%s' "$OUT" | grep -oE 'https?://[^ ]*/ext/bc/[A-Za-z0-9]+/rpc' | head -1)"
BID="$(printf '%s' "$OUT" | grep -iE 'BlockchainID \(HEX\)' | grep -oiE '0x[0-9a-f]{64}' | head -1)"
CID="$(printf '%s' "$OUT" | grep -iE 'ChainID' | grep -oE '[0-9]+' | head -1)"

[ -n "$RPC" ] || die "Could not read the Fuji RPC. Run: avalanche blockchain describe $NAME"

TOKEN="$(node -e "process.stdout.write(String(require('$CONFIG').token||'MYL1'))" 2>/dev/null || echo MYL1)"
CID="${CID:-$(node -e "process.stdout.write(String(require('$CONFIG').evmChainId||9999))" 2>/dev/null || echo 9999)}"

cat > "$CONFIG" <<EOF
{
  "configured": true,
  "network": "fuji",
  "name": "$NAME",
  "token": "$TOKEN",
  "evmChainId": $CID,
  "rpcUrl": "$RPC",
  "blockchainIdHex": "${BID:-}",
  "faucetAccount": { "address": "", "privateKey": "" }
}
EOF

say "Updated l1.config.json → $RPC (network: fuji)"
cat <<EOF

✔ Your L1 is on Fuji.

  • pnpm dev → the built-in explorer now points at your Fuji L1's RPC.
  • Connect your OWN funded wallet (no EWOQ on Fuji).
  • Keep this machine / your validator node running, and keep the validator
    balance topped up, or the L1 stops producing blocks.

There is no automatic hosted explorer for a custom Fuji L1 — this app's built-in
explorer is your window into the chain.
EOF
