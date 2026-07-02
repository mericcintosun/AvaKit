#!/usr/bin/env bash
#
# One-command local Interchain Token Transfer (ICTT) bridge.
#
# Spins up TWO Avalanche L1s (Subnet-EVM) with Interchain Messaging + a relayer,
# then deploys a full ICTT bridge across them: a demo ERC-20 + a Token Home on
# chain1, and a Token Remote on chain2, registered over ICM. Addresses land in
# bridge.config.json so the app can bridge tokens between the two chains.
#
# Requires avalanche-cli. Contract deploys use viem + the bundled ICTT artifacts
# (no Foundry, no on-machine Solidity compile) run through scripts/deploy-bridge.mjs.

set -uo pipefail

# Blockchain names + EVM chain ids are unique to this template so it can coexist
# with the icm-messenger devnet (icm1/icm2 · 1001/1002) on one machine.
CHAIN1="br1"; EVM1=2001; TOK1="TOK1"
CHAIN2="br2"; EVM2=2002; TOK2="TOK2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/bridge.config.json"

say() { printf "\033[1;37m▸\033[0m %s\n" "$1"; }
die() { printf "\033[1;31m✖\033[0m %s\n" "$1" >&2; exit 1; }

# Deploy an L1 to the local network with an actionable error on stale state.
deploy_local() {
  local name="$1"
  avalanche blockchain deploy "$name" --local </dev/null && return 0
  die "Deploy of '$name' failed.
     If it says a blockchain is already deployed, a previous local network is still
     around. Reset it and re-run:
       avalanche network clean && pnpm bridge
     Or wipe automatically on the next run:
       CLEAN=1 pnpm bridge"
}

if ! command -v avalanche >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✖ avalanche-cli not found. Install it:

  curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin

Then re-run: pnpm bridge
EOF
  exit 1
fi

# --- 0b. Opt-in clean slate -------------------------------------------------
# `CLEAN=1 pnpm bridge` wipes any existing local network first. Off by default
# so it never silently destroys unrelated local L1s (e.g. an icm-messenger devnet).
if [ "${CLEAN:-}" = "1" ]; then
  say "CLEAN=1 → wiping any existing local network…"
  avalanche network clean >/dev/null 2>&1 || true
fi

# --- 1. Create + deploy the two L1s (ICM + relayer on by default) -----------
create_l1() {
  local name="$1" cid="$2" tok="$3"
  say "Creating L1 '$name' (evm chainId $cid)…"
  avalanche blockchain create "$name" \
    --evm --latest --evm-chain-id "$cid" --evm-token "$tok" \
    --test-defaults --sovereign=false --icm --force </dev/null >/dev/null 2>&1 \
    || die "Failed to create '$name'. Try: avalanche blockchain delete $name"
}
create_l1 "$CHAIN1" "$EVM1" "$TOK1"
create_l1 "$CHAIN2" "$EVM2" "$TOK2"

say "Deploying '$CHAIN1' locally (this also starts the local network)…"
deploy_local "$CHAIN1"
say "Deploying '$CHAIN2' locally…"
deploy_local "$CHAIN2"

# --- 2. Discover each chain's RPC URL + hex blockchain ID -------------------
discover() {
  local name="$1" out
  out="$(avalanche blockchain describe "$name" 2>/dev/null)"
  local rpc bid
  rpc="$(printf '%s' "$out" | grep -oE 'http://127\.0\.0\.1:[0-9]+/ext/bc/[A-Za-z0-9]+/rpc' | head -1)"
  bid="$(printf '%s' "$out" | grep -iE 'BlockchainID \(HEX\)' | grep -oiE '0x[0-9a-f]{64}' | head -1)"
  printf '%s\t%s' "$rpc" "$bid"
}
say "Reading chain details…"
IFS=$'\t' read -r RPC1 BID1 < <(discover "$CHAIN1")
IFS=$'\t' read -r RPC2 BID2 < <(discover "$CHAIN2")
[ -n "$RPC1" ] && [ -n "$BID1" ] || die "Could not read '$CHAIN1' RPC/blockchain ID."
[ -n "$RPC2" ] && [ -n "$BID2" ] || die "Could not read '$CHAIN2' RPC/blockchain ID."

# --- 3. Write the partial config the deploy step reads ----------------------
cat > "$CONFIG" <<EOF
{
  "configured": false,
  "chain1": { "name": "$CHAIN1", "token": "$TOK1", "evmChainId": $EVM1, "rpcUrl": "$RPC1", "blockchainIdHex": "$BID1" },
  "chain2": { "name": "$CHAIN2", "token": "$TOK2", "evmChainId": $EVM2, "rpcUrl": "$RPC2", "blockchainIdHex": "$BID2" },
  "bridge": null
}
EOF

# --- 4. Deploy the ICTT bridge (demo token + home + remote + register) ------
say "Deploying the ICTT bridge (demo token, home, remote, registration)…"
command -v node >/dev/null 2>&1 || die "node is required to deploy the bridge contracts."
node "$ROOT/scripts/deploy-bridge.mjs" || die "Bridge deploy failed. Is the network healthy? Try: avalanche network status"

cat <<EOF

✔ Local ICTT bridge is up.

Next:
  1. Import the EWOQ dev key into your wallet (Core / MetaMask), pre-funded on both chains:
       0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027
     (public dev key, local only)
  2. pnpm dev  →  http://localhost:3000 (or the port Next prints)
  3. Mint the demo token on $CHAIN1, then bridge it to $CHAIN2 and watch it arrive.

Reset:
  avalanche network stop     # pause (keeps state)
  avalanche network clean    # wipe (re-run pnpm bridge)
  CLEAN=1 pnpm bridge        # wipe + rebuild in one step
EOF
