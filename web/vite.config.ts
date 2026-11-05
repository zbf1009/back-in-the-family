import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Task 4.1: in addition to the Svelte plugin, the `sim-wasm` alias (D3: map the
// bare specifier to the wasm-bindgen output in `target/wasm-pkg`) and the ES
// worker format, this config now:
//   - never inlines `.wasm` files, so the Sim_Wasm asset is always emitted as a
//     file (byte-identical to `wasm-build.sh` output), regardless of its size
//     (D3, R7.3);
//   - writes the set of npm packages whose code is in the output bundle to
//     `web/.bundle-report.json` (outside `dist`), which feeds the README
//     third-party table in task 4.6 (R1.8).

// Report the node_modules packages present in the final bundle. The list is
// derived from the module ids Rollup saw during `generateBundle`, is
// deduplicated and sorted so the output is deterministic.
function bundleReportPlugin(): Plugin {
  // `web/.bundle-report.json` sits next to this config, outside `dist`.
  const reportPath = fileURLToPath(new URL('./.bundle-report.json', import.meta.url));
  // Match `.../node_modules/<pkg>/...` or `.../node_modules/@scope/name/...`.
  const packageOf = (id: string): string | null => {
    // Normalise Windows separators so the regex is path-style agnostic.
    const normalised = id.replace(/\\/g, '/');
    const marker = '/node_modules/';
    const last = normalised.lastIndexOf(marker);
    if (last === -1) return null;
    const rest = normalised.slice(last + marker.length);
    const parts = rest.split('/');
    if (parts.length === 0 || parts[0] === '') return null;
    // Scoped package: `@scope/name`; otherwise just the first segment.
    if (parts[0].startsWith('@')) {
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    }
    return parts[0];
  };

  return {
    name: 'bundle-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const pkg = packageOf(id);
          if (pkg !== null) packages.add(pkg);
        }
      }
      const sorted = [...packages].sort();
      writeFileSync(reportPath, `${JSON.stringify(sorted, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), bundleReportPlugin()],
  resolve: {
    alias: {
      'sim-wasm': fileURLToPath(new URL('../target/wasm-pkg', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // Never inline `.wasm` as a data URL (return false); fall back to Vite's
    // default size-based behaviour for every other asset (return undefined).
    assetsInlineLimit: (filePath: string): boolean | undefined =>
      filePath.endsWith('.wasm') ? false : undefined,
  },
});
