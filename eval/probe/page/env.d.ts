// Ambient declarations for the Probe_Page: Vite's `?raw` imports, the build-time constants that
// vite.config.ts defines, and the `window.__probe` hook.
import type { ProbeApi } from './probe-core.ts';

declare global {
  /** Exact version of @mlc-ai/web-llm from eval/probe/package.json (defined by vite.config.ts). */
  const __WEBLLM_VERSION__: string;
  /** Exact version of @huggingface/transformers from eval/probe/package.json. */
  const __TRANSFORMERS_VERSION__: string;
  interface Window {
    __probe: ProbeApi;
  }
}
