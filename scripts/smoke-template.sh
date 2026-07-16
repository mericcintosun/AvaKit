#!/usr/bin/env bash
#
# Scaffold one create-avalanche-app template into a throwaway directory and verify
# it installs, type-checks, and production-builds — exactly the flow a real user
# gets from `npm create avalanche-app`. Used by the CI smoke matrix
# (.github/workflows/ci.yml) and runnable locally.
#
# It uses the LOCALLY BUILT scaffolder (packages/create-avalanche-app/dist), so a
# broken template or a scaffolder regression fails here before it can be published.
#
# @avakit/* resolution has two modes:
#   • default        — pack THIS repo's @avakit/core and @avakit/react and pin the
#                      scaffolded app to those tarballs via pnpm overrides. This
#                      tests the real published *artifact shape* while still
#                      covering unpublished changes, so a template that needs a new
#                      core feature is verified BEFORE release (no chicken-and-egg
#                      with the scaffolder pinning a version that isn't published yet).
#   • SMOKE_USE_NPM=1 — resolve @avakit/* from the npm registry instead, i.e. verify
#                      that the pins the scaffolder stamps (derived per package at
#                      build time) really resolve. Run this AFTER a release.
#
# Templates that need avalanche-cli at runtime (icm-messenger, l1-launch,
# token-bridge) are only scaffold+typecheck+build tested here; their devnet/L1
# scripts are not exercised (no avalanche-cli in CI).
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

if [ "${SMOKE_USE_NPM:-0}" = "1" ]; then
  echo "▸ [$TEMPLATE] resolving @avakit/* from npm (published pin)"
else
  echo "▸ [$TEMPLATE] packing local @avakit/* and pinning the app to them"
  PACK_DIR="$WORKDIR/.avakit-pack"
  rm -rf "$PACK_DIR"
  mkdir -p "$PACK_DIR"
  for pkg in core react; do
    if [ ! -d "$REPO/packages/$pkg/dist" ]; then
      echo "✖ packages/$pkg is not built — run: pnpm build" >&2
      exit 1
    fi
    ( cd "$REPO/packages/$pkg" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null )
  done
  CORE_TGZ="$(ls "$PACK_DIR"/avakit-core-*.tgz | head -1)"
  REACT_TGZ="$(ls "$PACK_DIR"/avakit-react-*.tgz | head -1)"
  # Override every @avakit/* resolution (the app's own deps *and* react's pinned
  # dependency on core) to the freshly packed tarballs. pnpm 10 reads `overrides`
  # from pnpm-workspace.yaml only — the package.json "pnpm" field is ignored.
  touch pnpm-workspace.yaml
  {
    echo ""
    echo "# Injected by scripts/smoke-template.sh: test against this repo's build."
    echo "overrides:"
    echo "  '@avakit/core': 'file:$CORE_TGZ'"
    echo "  '@avakit/react': 'file:$REACT_TGZ'"
  } >> pnpm-workspace.yaml
fi

echo "▸ [$TEMPLATE] pnpm install"
pnpm install

echo "▸ [$TEMPLATE] typecheck"
pnpm run typecheck

echo "▸ [$TEMPLATE] build"
pnpm run build

echo "✓ [$TEMPLATE] OK"
