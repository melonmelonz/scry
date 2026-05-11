#!/usr/bin/env bash
# No build step (yet). Stages source directories into web/dist/.
# Phase 2 will plug a Rust/wasm-pack/Vite pipeline in here for v2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[scry] staging -> web/dist/ ..."
rm -rf "$ROOT/web/dist"
mkdir -p "$ROOT/web/dist"

# Landing page at the root.
cp "$ROOT/web/index.html" "$ROOT/web/dist/index.html"

# Also expose the scope page at the root.
if [ -f "$ROOT/docs/scope.html" ]; then
  cp "$ROOT/docs/scope.html" "$ROOT/web/dist/scope.html"
fi

# v1 — pure JS/CSS/HTML.
if [ -d "$ROOT/web/v1" ]; then
  rsync -a "$ROOT/web/v1/" "$ROOT/web/dist/v1/"
fi

# v2 — placeholder until Rust→WASM pipeline lands.
if [ -d "$ROOT/web/v2" ]; then
  rsync -a "$ROOT/web/v2/" "$ROOT/web/dist/v2/"
fi

echo "[scry] staged:"
find "$ROOT/web/dist" -type f -printf '  %P\n' | sort
