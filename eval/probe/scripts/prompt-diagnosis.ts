// One-off diagnosis (Author request, 2026-11-08; Report-only, never an Exclusion_Record, never a verdict).
// Does the Qwen3.5-0.8B (transformers.js, NVIDIA) prefill OOM depend on prompt length? Runs the same two-session
// preflight method with (a) a ~1 KB prompt and (b) the longest Dev_Card prompt (~4.7 KB). Prompts come from the
// Dev_Cards only, through the renderer; the Locked_Cards are never read. Writes
// eval/results/preflight/diagnosis/<label>.json. Run: node scripts/prompt-diagnosis.ts <combo-id>
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prompt } from '../src/adapters/interface.ts';
import { loadCards } from '../src/cards.ts';
import { PREFLIGHT_TIMEOUT_MS, defaultPreflightDeps, promptBytes } from '../src/preflight.ts';
import { buildPlan, loadSchemas, loadTemplates, renderPlan, runManifestCheck } from '../src/run.ts';
import { RunLogger } from '../src/run-logger.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const comboId = process.argv[2] ?? 'transformers.js/qwen3.5-0.8b-q4/nvidia';
const deps = await defaultPreflightDeps(REPO);
const combo = deps.combinations.find((c) => c.id === comboId);
if (combo === undefined) throw new Error(`unknown Combination ${comboId}`);

await runManifestCheck(deps, new RunLogger());
const cards = loadCards({ cardsDir: deps.paths.cardsDir, splits: ['dev'] }).cards.dev;
const templates = loadTemplates(deps.paths);
const plan = buildPlan(cards, ['decision', 'synthesis']);
const rendered = renderPlan(plan, templates, loadSchemas(deps.paths.cardsDir, plan), combo);
if (rendered.errors.length > 0) throw new Error('Dev_Card prompts did not render');
const prompts = plan.flatMap((p) => (p.prompt === null ? [] : [p.prompt]));
const longest = prompts.reduce((a, b) => (promptBytes(b) > promptBytes(a) ? b : a));

/** Cut the user text of the longest prompt (on a UTF-8 safe boundary) so the whole prompt is about `bytes` long. */
function cut(p: Prompt, bytes: number): Prompt {
  const room = Math.max(0, bytes - Buffer.byteLength(p.system, 'utf8'));
  return { system: p.system, user: Buffer.from(p.user, 'utf8').subarray(0, room).toString('utf8').replace(/\uFFFD$/, '') };
}

const variants: [string, Prompt][] = [
  ['short_1kb', cut(longest, 1000)],
  ['longest_dev_4_7kb', longest],
];
const outDir = path.join(deps.paths.resultsDir, 'preflight', 'diagnosis');
fs.mkdirSync(outDir, { recursive: true });

for (const [label, prompt] of variants) {
  const session = await deps.openSession(combo);
  try {
    const prepared = await session.prepare();
    if (!prepared.ok) throw new Error(`prepare failed: ${prepared.failure.reason}: ${prepared.failure.detail}`);
    let result: unknown;
    try {
      const m = await session.preflight(prompt, { maxNewTokens: 1024, minNewTokens: 1024, timeoutMs: PREFLIGHT_TIMEOUT_MS });
      result = {
        run: m.run,
        peak_mib: m.memory.gpu === 'nvidia' ? m.memory.peak_mib : null,
        memory: m.memory,
        placement: m.placement,
        other_processes_card_before: m.otherProcesses?.card ?? null,
      };
    } catch (e) {
      result = { threw: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
    const doc = { schema: 'llm-probe-prompt-diagnosis-v1', at: new Date().toISOString(), combination: combo.id, label, prompt_bytes: promptBytes(prompt), result };
    fs.writeFileSync(path.join(outDir, `${label}.json`), `${JSON.stringify(doc, null, 2)}\n`);
    console.log(label, prompt.system.length + prompt.user.length, JSON.stringify(result).slice(0, 700));
  } finally {
    await session.close();
  }
}
