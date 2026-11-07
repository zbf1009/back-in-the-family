// Probe_Page build (llm-probe task 16.7; design DA-4 A, R10.2, R10.7). A separate Vite app rooted at
// eval/probe/page and built to eval/probe/dist. It never writes to web/dist, and nothing here sets
// COOP or COEP headers (neither engine's WebGPU path needs SharedArrayBuffer; `require-corp` would block
// cross-origin weight downloads that lack CORP headers).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export const PROBE_PAGE_PORT = 4318;
export const PROBE_PAGE_ROOT = fileURLToPath(new URL('./page/', import.meta.url));
export const PROBE_PAGE_DIST = fileURLToPath(new URL('./dist/', import.meta.url));

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
const exact = (name: string): string => {
  const v = pkg.dependencies[name];
  if (v === undefined) throw new Error(`eval/probe/package.json has no dependency "${name}"`);
  return v;
};

export default defineConfig({
  root: PROBE_PAGE_ROOT,
  base: './',
  // Engines are real dependencies of this package; the exact versions go into the Model_Fingerprint.
  define: {
    __WEBLLM_VERSION__: JSON.stringify(exact('@mlc-ai/web-llm')),
    __TRANSFORMERS_VERSION__: JSON.stringify(exact('@huggingface/transformers')),
  },
  build: {
    outDir: PROBE_PAGE_DIST,
    emptyOutDir: true,
    target: 'es2022',
  },
  // localhost only: a secure context for WebGPU, and not reachable from other machines.
  preview: { host: 'localhost', port: PROBE_PAGE_PORT, strictPort: true },
  server: { host: 'localhost', port: PROBE_PAGE_PORT, strictPort: true },
});
