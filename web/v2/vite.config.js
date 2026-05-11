import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// v2 lives at /v2/ on the deployed site.
export default defineConfig({
  base: '/v2/',
  plugins: [svelte(), wasm(), topLevelAwait()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
