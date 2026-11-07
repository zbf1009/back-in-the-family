// Probe_Page entry (llm-probe task 16.7; R10.2, R10.3). Installs `window.__probe` and a minimal
// control panel for the Author's headed run. Engines run on this page's main thread.
//
// The page receives prompts only through a bundle (R10.11): it imports no card file, and the only
// repository files bundled into it are the two Warm_Up_Prompts, `combinations.json` and the adapter
// modules under ../src/adapters.
import combinationsJson from '../combinations.json';
import warmupDecision from '../warmup/decision.txt?raw';
import warmupSynthesis from '../warmup/synthesis.txt?raw';
import type { GpuLike } from '../src/adapters/gpu.ts';
import type { Combination } from '../src/phase.ts';
import { browserClock, makeRuntime } from './engines.ts';
import { createProbeController, exportFileName, parseWarmupText, type KeyValueStore } from './probe-core.ts';

const combinations = (combinationsJson as unknown as Combination[]).filter((c) => c.runtime !== 'workers-ai');

const store: KeyValueStore = {
  get: (k) => window.localStorage.getItem(k),
  set: (k, v) => window.localStorage.setItem(k, v),
};

const probe = createProbeController({
  gpu: (navigator as unknown as { gpu?: GpuLike }).gpu,
  userAgent: navigator.userAgent,
  clock: browserClock,
  wallNow: () => Date.now(),
  combinations,
  warmups: { decision: parseWarmupText(warmupDecision), synthesis: parseWarmupText(warmupSynthesis) },
  store,
  makeRuntime: makeRuntime({ webllm: __WEBLLM_VERSION__, transformers: __TRANSFORMERS_VERSION__ }),
  // The driver reads ORT's placement lines and these status lines from the page console.
  log: (line) => console.log(line),
});

window.__probe = probe;

// ---------------------------------------------------------------- control panel

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el as T;
};

const statusEl = byId<HTMLPreElement>('status');
const comboEl = byId<HTMLSelectElement>('combo');
const render = (extra?: string): void => {
  statusEl.textContent = `${JSON.stringify(probe.status(), null, 2)}${extra === undefined ? '' : `\n${extra}`}`;
};

async function guarded(step: () => Promise<string | void>): Promise<void> {
  try {
    const note = await step();
    render(note ?? undefined);
  } catch (e) {
    render(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

for (const c of combinations) {
  const o = document.createElement('option');
  o.value = c.id;
  o.textContent = c.id;
  comboEl.append(o);
}
const wanted = new URLSearchParams(location.search).get('combo');
if (wanted !== null && combinations.some((c) => c.id === wanted)) comboEl.value = wanted;
if (comboEl.value !== '') probe.selectCombination(comboEl.value);
comboEl.addEventListener('change', () => {
  probe.selectCombination(comboEl.value);
  render();
});

byId('check').addEventListener('click', () => void guarded(async () => JSON.stringify(await probe.checkAdapter())));
byId('cold').addEventListener('click', () => void guarded(async () => `cold start: ${await probe.coldStart()} ms`));
byId('bundle').addEventListener('change', (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  void guarded(async () => {
    const info = probe.loadBundle(JSON.parse(await file.text()));
    comboEl.value = probe.status().combo ?? comboEl.value;
    return `bundle ${info.run_id}: ${info.requests} requests`;
  });
});
byId('run').addEventListener('click', () => void guarded(async () => `answered ${(await probe.runBundle()).length} requests`));
byId('download').addEventListener('click', () =>
  void guarded(async () => {
    const exp = probe.export();
    const url = URL.createObjectURL(new Blob([probe.exportText()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(exp.run_id);
    a.click();
    URL.revokeObjectURL(url);
    return `downloaded ${a.download}`;
  }),
);
render();
