import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Task 1.1: Svelte plugin only. Task 3.1 adds the `sim-wasm` alias (D3: map the
// bare specifier to the wasm-bindgen output in `target/wasm-pkg`) and the ES
// worker format so `import.meta.url` worker imports bundle as modules. The asset
// inline rule and the bundle-report plugin are added in task 4.1.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      'sim-wasm': fileURLToPath(new URL('../target/wasm-pkg', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
});
