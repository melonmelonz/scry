#!/usr/bin/env bash
# Stages the scry workbench into web/dist/.
#   v1 — pure JS, no bundler. Source is copied verbatim, then minified.
#   v2 — Rust → wasm-pack → Vite/Svelte 5 build (Vite minifies by default).
#
# v1 minification: we re-use the esbuild binary that Vite installs for v2 so
# we don't need a second toolchain. Both JS and CSS are minified in-place
# inside web/dist/v1/. HTML is left as-is; Cloudflare Pages serves brotli.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
WASM_PACK="${WASM_PACK:-$HOME/.cargo/bin/wasm-pack}"
[ -x "$CARGO" ] || CARGO="cargo"
[ -x "$WASM_PACK" ] || WASM_PACK="wasm-pack"

echo "[scry] === phase 1: build v2 (Rust -> wasm) ==="
cd "$ROOT/rust/scry-core"
"$WASM_PACK" build --target web --release --out-dir "$ROOT/web/v2/src/wasm"

echo "[scry] === phase 2: build v2 (Vite/Svelte) ==="
cd "$ROOT/web/v2"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
npm run build

ESBUILD="$ROOT/web/v2/node_modules/.bin/esbuild"

echo "[scry] === phase 3: stage -> web/dist/ ==="
cd "$ROOT"
rm -rf "$ROOT/web/dist"
mkdir -p "$ROOT/web/dist"

# Landing page at the root.
cp "$ROOT/web/index.html" "$ROOT/web/dist/index.html"

# Scope page at the root.
if [ -f "$ROOT/docs/scope.html" ]; then
  cp "$ROOT/docs/scope.html" "$ROOT/web/dist/scope.html"
fi

# v1 — pure JS/CSS/HTML.
if [ -d "$ROOT/web/v1" ]; then
  rsync -a "$ROOT/web/v1/" "$ROOT/web/dist/v1/"
fi

# v2 — copy the Vite build output, not the source tree.
if [ -d "$ROOT/web/v2/dist" ]; then
  rsync -a "$ROOT/web/v2/dist/" "$ROOT/web/dist/v2/"
fi

# --- Phase 4: minify v1 assets in place ---------------------------------
# esbuild rewrites each file with --minify (whitespace + syntax + identifiers).
# v1's JS is ES modules with relative imports, which esbuild preserves.
if [ -x "$ESBUILD" ]; then
  echo "[scry] === phase 4: minify v1 ==="
  while IFS= read -r -d '' f; do
    "$ESBUILD" --minify --log-level=error --allow-overwrite --outfile="$f" "$f"
  done < <(find "$ROOT/web/dist/v1" -type f \( -name '*.js' -o -name '*.css' \) -print0)
else
  echo "[scry] WARN: esbuild not found at $ESBUILD; v1 not minified"
fi

echo "[scry] staged:"
find "$ROOT/web/dist" -type f -printf '  %P\n' | sort
