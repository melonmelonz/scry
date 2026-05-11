#!/usr/bin/env bash
# Phase 1: no build step. The web/ directory is the deployable.
# This script stages web/ into web/dist/ so deploy.sh has a stable target,
# and phase 2 can plug a real bundler in here without changing deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[scry] staging web/ -> web/dist/ ..."
rm -rf "$ROOT/web/dist"
mkdir -p "$ROOT/web/dist"

# Copy every file under web/ except the dist directory itself.
rsync -a --exclude='dist/' --exclude='node_modules/' "$ROOT/web/" "$ROOT/web/dist/"

echo "[scry] staged. files:"
find "$ROOT/web/dist" -type f -printf '  %P\n'
