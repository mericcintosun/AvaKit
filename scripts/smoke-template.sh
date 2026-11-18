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
#
# Without a workdir the app is built in a temporary directory that is removed when
# the script exits, pass or fail: one run leaves an installed and built Next.js app
# plus the packed tarballs behind otherwise. Set SMOKE_KEEP=1 to keep that
# directory (its path is printed), or pass a workdir, which is never removed.
set -euo pipefail

# A smoke run is this repo testing itself, not someone using AvaKit, so it must
# never be counted as usage. The scaffolder reports each run to the production
# collector unless telemetry is off, and its CI detection does not cover a run on
# a developer's machine: on 2026-11-18 local smoke runs added 52 scaffolds to the
# public count on avakit.dev/stats. Switch telemetry off here, for every process
# this script starts, instead of relying on the caller to remember.
export AVAKIT_TELEMETRY_DISABLED=1

TEMPLATE="${1:?usage: smoke-template.sh <template-id> [workdir]}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO/packages/create-avalanche-app/dist/index.js"
BUILD_HINT='pnpm --filter "@avakit/core" --filter "@avakit/react" --filter create-avalanche-app build'

# Check everything the run needs before scaffolding anything.
if [ ! -f "$CLI" ]; then
  echo "✖ $CLI not found — run: $BUILD_HINT" >&2
  exit 1
fi
if [ "${SMOKE_USE_NPM:-0}" != "1" ]; then
  for pkg in core react; do
    if [ ! -d "$REPO/packages/$pkg/dist" ]; then
      echo "✖ packages/$pkg is not built — run: $BUILD_HINT" >&2
      exit 1
    fi
  done
fi

# Only a directory this script created itself is ever removed.
REMOVE_WORKDIR=0
cleanup() {
  local status=$?
  [ "$REMOVE_WORKDIR" = "1" ] || return 0
  if [ "${SMOKE_KEEP:-0}" = "1" ]; then
    echo "▸ [$TEMPLATE] kept $WORKDIR (SMOKE_KEEP=1)"
    return 0
  fi
  # Leave the directory before deleting it.
  cd /
  rm -rf "$WORKDIR"
  if [ "$status" -ne 0 ]; then
    echo "▸ [$TEMPLATE] removed the temporary app; re-run with SMOKE_KEEP=1 to inspect it" >&2
  fi
}
trap cleanup EXIT

if [ -n "${2:-}" ]; then
  WORKDIR="$2"
  mkdir -p "$WORKDIR"
else
  WORKDIR="$(mktemp -d)"
  REMOVE_WORKDIR=1
fi
# Absolute, because the steps below change directory and still refer to it.
WORKDIR="$(cd "$WORKDIR" && pwd)"

APP_NAME="smoke-$TEMPLATE"
APP_DIR="$WORKDIR/$APP_NAME"
rm -rf "$APP_DIR"

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
