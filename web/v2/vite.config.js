import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// v2 may be served from /scry/v2/ on goolz.org or /v2/ if scry ever moves to
// a dedicated origin. Use relative base so the same build works everywhere.
export default defineConfig({
  base: './',
  plugins: [svelte(), wasm(), topLevelAwait()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
