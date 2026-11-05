import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Task 1.1: Svelte plugin only. The `sim-wasm` alias, worker format, asset
// inline rule and the bundle-report plugin are added in tasks 3.1 and 4.1.
export default defineConfig({
  plugins: [svelte()],
});
