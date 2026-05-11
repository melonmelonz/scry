#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$HOME/dev/goolz/scry"

if [ ! -d "$ROOT/web/dist" ]; then
  echo "[scry] no dist. run scripts/build.sh first."
  exit 1
fi

if [ ! -d "$TARGET" ]; then
  echo "[scry] target $TARGET does not exist. is goolz repo cloned?"
  exit 1
fi

echo "[scry] syncing web/dist/ -> $TARGET ..."
rsync -a --delete --exclude='.git*' "$ROOT/web/dist/" "$TARGET/"

echo "[scry] committing in goolz..."
cd "$HOME/dev/goolz"

if git diff --quiet HEAD -- scry/; then
  echo "[scry] no changes in goolz/scry/. nothing to commit."
  exit 0
fi

git add scry/
# ASCII-only commit message (CF Pages wrangler-action fails on unicode).
git commit -m "scry: deploy phase 1 - app shell + hex viewer ($(date +%Y-%m-%d-%H%M))"
git push

echo "[scry] deployed. cloudflare pages will pick it up shortly."
echo "[scry] check https://goolz.org/scry"
