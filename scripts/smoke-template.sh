#!/usr/bin/env bash
#
# Scaffold one create-avalanche-app template into a throwaway directory and verify
# it installs, type-checks, and production-builds — exactly the flow a real user
# gets from `npm create avalanche-app`. Used by the CI smoke matrix
# (.github/workflows/ci.yml) and runnable locally.
#
# It uses the LOCALLY BUILT scaffolder (packages/create-avalanche-app/dist), so a
# broken template or a scaffolder regression fails here before it can be published.
# The scaffolded app resolves @avakit/* from the npm registry (published), so this
# does NOT test unpublished @avakit changes — those are covered by the package
# build/typecheck jobs. Templates that need avalanche-cli at runtime
# (icm-messenger, l1-launch, token-bridge) are only scaffold+typecheck+build tested
# here; their devnet/L1 scripts are not exercised (no avalanche-cli in CI).
#
# Usage: scripts/smoke-template.sh <template-id> [workdir]
set -euo pipefail

TEMPLATE="${1:?usage: smoke-template.sh <template-id> [workdir]}"
WORKDIR="${2:-$(mktemp -d)}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO/packages/create-avalanche-app/dist/index.js"

if [ ! -f "$CLI" ]; then
  echo "✖ $CLI not found — run: pnpm --filter create-avalanche-app build" >&2
  exit 1
fi

APP_NAME="smoke-$TEMPLATE"
APP_DIR="$WORKDIR/$APP_NAME"
rm -rf "$APP_DIR"
mkdir -p "$WORKDIR"

echo "▸ [$TEMPLATE] scaffolding into $APP_DIR"
( cd "$WORKDIR" && node "$CLI" "$APP_NAME" --template "$TEMPLATE" --yes --no-install )

cd "$APP_DIR"
echo "▸ [$TEMPLATE] pnpm install"
pnpm install

echo "▸ [$TEMPLATE] typecheck"
pnpm run typecheck

echo "▸ [$TEMPLATE] build"
pnpm run build

echo "✓ [$TEMPLATE] OK"
