// Property 26 (llm-probe task 13.10): locked runs print no card content.
// **Validates: Requirements 3.1, 3.11.**
// SYNTHETIC "locked-shaped" card sets in temp dirs (the real eval/results, ledger and locked.jsonl are never
// touched): the locked split is the dev lines with new IDs and a random, unique marker injected into every
// text field (situation, person names, option labels, player input, author note, changed fact). A fake
// Runtime (and a fake page export) answers with outputs that carry random markers too. For a headless
// Locked_Run, `page-bundle`, `ingest`, `regrade` and `report`:
// - stdout and stderr hold no marker; progress lines are counts only; the report holds no marker;
// - no file outside the Results (and the bundle that is meant to hold prompts) holds a marker;
// - `ingest`, `regrade` and `report` make zero `llm_render_prompt` calls (counted in simwasm.ts).
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import type { AdapterResult } from '../../src/adapters/interface.ts';
import { DEFAULT_CARDS_DIR } from '../../src/cards.ts';
import { ingest, PAGE_EXPORT_SCHEMA, readBundle, regrade, writeBundle, type Bundle } from '../../src/ingest.ts';
import { readLedger } from '../../src/ledger.ts';
import { reportCommand, reportPaths } from '../../src/report-command.ts';
import { devRun, lockedRun } from '../../src/run.ts';
import { renderPromptCalls } from '../../src/simwasm.ts';
import { capture, createFakeRuntime, defaultAnswer, FAKE_COMBO, makeEnv, REVISION, sha256, type TestCards, type TestEnv } from './run.helpers.ts';

type Json = Record<string, unknown>;

const devLines = readFileSync(path.join(DEFAULT_CARDS_DIR, 'cards', 'dev.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

function rowFor(lines: readonly string[]): string {
  let d = 0;
  let s = 0;
  let z = 0;
  for (const l of lines) {
    const c = JSON.parse(l) as { task: string; scored: boolean };
    if (!c.scored) z++;
    else if (c.task === 'decision') d++;
    else s++;
  }
  return `${lines.length} | ${d} | ${s} | ${z}`;
}

interface Marked extends TestCards {
  /** Markers injected into the locked cards' text fields. */
  readonly cardMarkers: readonly string[];
}

/** A temp Card_Set whose locked split is the dev lines with new IDs and one unique marker in every text field. */
function makeMarkedCardSet(tag: string): Marked {
  const dir = mkdtempSync(path.join(tmpdir(), 'silent-cards-'));
  mkdirSync(path.join(dir, 'cards'));
  cpSync(path.join(DEFAULT_CARDS_DIR, 'schemas'), path.join(dir, 'schemas'), { recursive: true });
  const markers: string[] = [];
  let n = 0;
  const mk = (field: string): string => {
    const m = `ZQ${tag}${field}${n++}`;
    markers.push(m);
    return m;
  };
  const lockedObjs = devLines.map((l) => {
    const c = JSON.parse(l) as Json & { id: string; context: Json & { situation?: string; people?: { name: string }[]; player_input?: { content?: string } }; author_note?: string; options?: { label: string }[]; contrast?: { changed_fact?: string } };
    c.id = c.id.replace(/-(\d{3})$/, (_m, d: string) => `-${900 + Number(d)}`);
    c['split'] = 'locked';
    if (typeof c.context.situation === 'string') c.context.situation += ` ${mk('sit')}`;
    for (const p of c.context.people ?? []) p.name += ` ${mk('name')}`;
    if (typeof c.context.player_input?.content === 'string') c.context.player_input.content += ` ${mk('input')}`;
    if (typeof c.author_note === 'string') c.author_note += ` ${mk('note')}`;
    for (const o of c.options ?? []) o.label += ` ${mk('label')}`;
    if (typeof c.contrast?.changed_fact === 'string') c.contrast.changed_fact += ` ${mk('fact')}`;
    return c;
  });
  const locked = lockedObjs.map((c) => JSON.stringify(c));
  writeFileSync(path.join(dir, 'cards', 'dev.jsonl'), devLines.join('\n') + '\n');
  writeFileSync(path.join(dir, 'cards', 'locked.jsonl'), locked.join('\n') + '\n');
  writeFileSync(
    path.join(dir, 'LOCK.md'),
    '# Lock\n\n## Contents\n\n| Split | Cards | Scored D | Scored S | Sanity (unscored) | Scenario groups | Contrast pairs (D / S) | sha256 |\n|---|---|---|---|---|---|---|---|\n' +
      `| dev | ${rowFor(devLines)} | 1 | x | \`h\` |\n| locked | ${rowFor(locked)} | 1 | x | \`h\` |\n` +
      '\n## Voided cards\n\n| Date | Card | Reason |\n|---|---|---|\n| none | | |\n',
  );
  const listed = ['LOCK.md', 'cards/dev.jsonl', 'cards/locked.jsonl', ...readdirSync(path.join(dir, 'schemas')).sort().map((f) => `schemas/${f}`)];
  const manifest = listed.map((rel) => `${sha256(readFileSync(path.join(dir, rel)))}  ${rel}\n`).join('');
  writeFileSync(path.join(dir, 'MANIFEST.sha256'), manifest);
  return {
    dir,
    pinnedHash: sha256(manifest),
    lockedIds: lockedObjs.map((c) => c.id),
    devIds: devLines.map((l) => (JSON.parse(l) as { id: string }).id),
    cardMarkers: markers,
  };
}

// ---------------------------------------------------------------- helpers

const FINGERPRINT = {
  runtime: { name: 'fake-runtime', version: '1.0.0' },
  model: { id: 'Fake-1B', revision: REVISION, model_lib_url: null, quantization: 'q4' },
  model_key: { runtime: 'fake-runtime', model_id: 'Fake-1B', quantization: 'q4', revision: REVISION },
  sampling: { temperature: 0, top_p: null, seed: 7, max_output_tokens: { decision: 64, synthesis: 1024 } },
  chat_template_kwargs: { enable_thinking: false },
  constraint: 'json_schema',
  browser: { version: '155.0.8059.84', headless: false, flags: [] },
  webgpu: { power_preference: 'high-performance', vendor: 'nvidia', architecture: 'ampere', device: '', description: 'NVIDIA synthetic adapter' },
  measurement: 'probe_page',
};

type Kind = 'valid' | 'marked_valid' | 'junk' | 'late' | 'error';
const KINDS: readonly Kind[] = ['valid', 'marked_valid', 'junk', 'late', 'error'];

/** A well-formed answer for the prompt that also carries `marker` in an extra field (or as junk). */
function markedAnswer(prompt: { user: string }, marker: string): string {
  const base = JSON.parse(defaultAnswer({ system: '', user: prompt.user })) as Json;
  return JSON.stringify({ ...base, note: marker });
}

const sinkMarkers: string[] = [];
const outputMarker = (tag: string, i: number): string => {
  const m = `ZQ${tag}OUT${i}`;
  sinkMarkers.push(m);
  return m;
};

const HEX = '0123456789abcdef'.split('');
const tagArb = fc.array(fc.constantFrom(...HEX), { minLength: 10, maxLength: 14 }).map((a) => a.join(''));
const planArb = fc.array(fc.constantFrom(...KINDS), { minLength: 1, maxLength: 7 });

function scriptedRuntime(plan: readonly Kind[], tag: string) {
  return createFakeRuntime({
    script: (i, p): AdapterResult => {
      const kind = plan[i % plan.length] as Kind;
      const m = outputMarker(tag, i);
      switch (kind) {
        case 'valid':
          return { kind: 'text', text: defaultAnswer(p), latencyMs: 4, usage: null };
        case 'marked_valid':
          return { kind: 'text', text: markedAnswer(p, m), latencyMs: 5, usage: null };
        case 'junk':
          return { kind: 'text', text: `not an answer ${m}`, latencyMs: 6, usage: null };
        case 'late':
          return { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'late', text: `late ${m}`, latencyMs: 12_000 }) };
        default:
          return { kind: 'error', code: 'runtime_error', detail: 'scripted', elapsedMs: 1, remote: null };
      }
    },
  });
}

/** Every file under `root` as relative path -> text. */
function filesUnder(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(root, p), fs.readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out;
}

const PROGRESS = /^probe: progress( D \d+\/\d+)?( S \d+\/\d+)?$/;

/** No marker on the console; every progress line is counts only. */
function assertSilent(what: string, out: string, err: string, markers: readonly string[]): void {
  const all = out + err;
  for (const m of markers) assert.ok(!all.includes(m), `${what}: console output holds marker ${m}`);
  for (const line of all.split('\n')) if (line.startsWith('probe: progress')) assert.match(line, PROGRESS, `${what}: progress line`);
}

/** No file outside the Results, the bundle and the stored export holds a marker. */
function assertFilesClean(what: string, root: string, cardMarkers: readonly string[], outputMarkers: readonly string[]): void {
  for (const [rel, text] of filesUnder(root)) {
    if (rel.startsWith(`eval/results/bundles${path.sep}`)) continue; // prompts live here by design
    for (const m of cardMarkers) assert.ok(!text.includes(m), `${what}: card marker ${m} in ${rel}`);
    if (rel.startsWith(`eval/results${path.sep}locked${path.sep}`) || rel.startsWith(`eval/results${path.sep}ingest${path.sep}`)) continue; // model output lives here
    for (const m of outputMarkers) assert.ok(!text.includes(m), `${what}: output marker ${m} in ${rel}`);
  }
}

/** Number of renders of any locked card during `fn` (IDs are the synthetic locked IDs). */
async function lockedRenders<T>(locked: ReadonlySet<string>, fn: () => Promise<T>): Promise<{ result: T; renders: number }> {
  const before = renderPromptCalls.length;
  const result = await fn();
  const renders = renderPromptCalls.slice(before).filter((id) => id === undefined || locked.has(id)).length;
  return { result, renders };
}

function writeCombinations(root: string): void {
  const file = reportPaths(root).combinations;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([FAKE_COMBO]));
}

async function cleanDev(env: TestEnv): Promise<void> {
  const run = await capture(() => devRun(env.deps(createFakeRuntime()), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(run.value, 0, run.err);
}

async function checkReport(env: TestEnv, cards: Marked, markers: readonly string[], locked: ReadonlySet<string>): Promise<void> {
  writeCombinations(env.root);
  const paths = { ...reportPaths(env.root), cardsDir: cards.dir };
  const { result, renders } = await lockedRenders(locked, () => capture(() => reportCommand(paths)));
  assert.equal(result.value, 0, result.err);
  assert.equal(renders, 0, 'report renders no locked card');
  assertSilent('report', result.out, result.err, markers);
  for (const line of result.out.split('\n').filter((l) => l !== '')) assert.match(line, /^report: wrote docs\/llm-probe\.md \(\d+ Locked_Run entries, \d+ Dev_Runs\)$/);
  const report = fs.readFileSync(paths.reportFile, 'utf8');
  for (const m of markers) assert.ok(!report.includes(m), `report holds marker ${m}`);
  // Card text of the dev lines the locked cards were made from is not in the report either.
  for (const word of ['Harold', 'June Pike', 'ladder']) assert.ok(!report.includes(word), `report holds card text "${word}"`);
}

function resultsFileOf(env: TestEnv, entryId: string): string {
  return path.join(env.root, 'eval/results/locked', `${entryId}.jsonl`);
}

// ---------------------------------------------------------------- the property

test('Property 26: locked runs, page-bundle, ingest, regrade and report print and write no card content', async () => {
  let sawOutputInResults = 0;
  let sawCardInPrompts = 0;
  await fc.assert(
    fc.asyncProperty(tagArb, planArb, fc.array(fc.constantFrom<'text' | 'late' | 'error'>('text', 'text', 'late', 'error'), { minLength: 1, maxLength: 5 }), async (tag, plan, exportKinds) => {
      const cards = makeMarkedCardSet(tag);
      const lockedIds = new Set(cards.lockedIds);

      // --- (a) a headless Locked_Run with a fake Runtime whose outputs carry markers.
      const env = makeEnv(cards);
      await cleanDev(env);
      const rt = scriptedRuntime(plan, tag);
      const run = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
      assert.ok(run.value === 0 || run.value === 1, run.err);
      assert.ok(rt.calls.length > 0);
      if (rt.calls.some((c) => cards.cardMarkers.some((m) => c.user.includes(m)))) sawCardInPrompts++;
      const outputMarkers = sinkMarkers.filter((m) => m.startsWith(`ZQ${tag}OUT`));
      const markers = [...cards.cardMarkers, ...outputMarkers];
      assertSilent('lockedRun', run.out, run.err, markers);
      assertFilesClean('lockedRun', env.root, cards.cardMarkers, outputMarkers);
      const [entry] = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries;
      assert.ok(entry);
      const results = resultsFileOf(env, entry.entry_id);
      assert.ok(fs.existsSync(results));
      if (outputMarkers.some((m) => fs.readFileSync(results, 'utf8').includes(m))) sawOutputInResults++;

      // --- (a2) regrade and report over that run: no render of any locked card.
      const re = await lockedRenders(lockedIds, () => capture(() => regrade(env.deps(createFakeRuntime()), results)));
      assert.equal(re.result.value, 0, re.result.err);
      assert.equal(re.renders, 0, 'regrade renders no locked card');
      assertSilent('regrade', re.result.out, re.result.err, markers);
      await checkReport(env, cards, markers, lockedIds);
      assertFilesClean('after report', env.root, cards.cardMarkers, outputMarkers);

      // --- (b) page-bundle, then ingest of an export whose outputs carry markers.
      const env2 = makeEnv(cards);
      await cleanDev(env2);
      const deps2 = env2.deps(createFakeRuntime({ script: () => Promise.reject(new Error('a bundle must not call the Runtime')) }));
      const hook = (d: Parameters<typeof writeBundle>[1]): void => void writeBundle(deps2.paths.resultsDir, d);
      const bundled = await capture(() => lockedRun(deps2, { combo: FAKE_COMBO.id, task: 'D', pageBundle: hook }));
      assert.equal(bundled.value, 0, bundled.err);
      assertSilent('page-bundle', bundled.out, bundled.err, markers);
      const [entry2] = readLedger(path.join(env2.root, 'eval/results/ledger.jsonl')).entries;
      assert.ok(entry2);
      const bundle: Bundle = readBundle(deps2.paths.resultsDir, entry2.entry_id);
      assert.ok(bundle.requests.some((r) => cards.cardMarkers.some((m) => r.prompt.user.includes(m))), 'the bundle holds the prompts');
      const exportMarkers: string[] = [];
      const exp: Json = {
        schema: PAGE_EXPORT_SCHEMA,
        run_id: bundle.run_id,
        split: bundle.split,
        template_hashes: { ...bundle.template_hashes },
        pinned_manifest_hash: bundle.pinned_manifest_hash,
        fingerprint: JSON.parse(JSON.stringify(FINGERPRINT)) as Json,
        cold_start: { empty_cache_ms: 41250, warm_cache_ms: 6120 },
        entries: bundle.requests.map((r, i) => {
          const m = `ZQ${tag}EXP${i}`;
          exportMarkers.push(m);
          const kind = exportKinds[i % exportKinds.length];
          const base = { card_id: r.card_id, permutation: r.permutation, requested_at: '2026-11-07T10:15:02.118Z' };
          if (kind === 'late') return { ...base, outcome: { kind: 'timeout' }, latency_ms: 10_000, late: { kind: 'late', text: `late ${m}`, latency_ms: 12_000 } };
          if (kind === 'error') return { ...base, outcome: { kind: 'error', code: 'model_load_failed', detail: 'GPU lost' }, latency_ms: 5, late: null };
          return { ...base, outcome: { kind: 'text', text: i % 2 === 0 ? markedAnswer(r.prompt, m) : `not an answer ${m}` }, latency_ms: 50 + (i % 900), late: null };
        }),
      };
      const exportFile = path.join(mkdtempSync(path.join(tmpdir(), 'silent-export-')), 'export.json');
      writeFileSync(exportFile, JSON.stringify(exp));
      const allMarkers = [...markers, ...exportMarkers];
      const ing = await lockedRenders(lockedIds, () => capture(() => ingest(deps2, exportFile)));
      assert.equal(ing.result.value, 0, ing.result.err);
      assert.equal(ing.renders, 0, 'ingest renders no locked card');
      assertSilent('ingest', ing.result.out, ing.result.err, allMarkers);
      assertFilesClean('ingest', env2.root, cards.cardMarkers, exportMarkers);

      const results2 = resultsFileOf(env2, entry2.entry_id);
      const re2 = await lockedRenders(lockedIds, () => capture(() => regrade(deps2, results2)));
      assert.equal(re2.result.value, 0, re2.result.err);
      assert.equal(re2.renders, 0, 'regrade renders no locked card');
      assertSilent('regrade (ingested)', re2.result.out, re2.result.err, allMarkers);
      await checkReport(env2, cards, allMarkers, lockedIds);
      assertFilesClean('after report (ingested)', env2.root, cards.cardMarkers, exportMarkers);
    }),
    { numRuns: 4 },
  );
  assert.ok(sawOutputInResults > 0, 'the scripted outputs reached the Results (the scan is meaningful)');
  assert.ok(sawCardInPrompts > 0, 'the card markers reached the prompts (the scan is meaningful)');
});

test('Property 26 control: the marker scan sees a marker when one is printed or written', () => {
  assert.throws(() => assertSilent('x', 'probe: ZQabc\n', '', ['ZQabc']));
  assert.throws(() => assertSilent('x', 'probe: progress D 1/2 ZQabc\n', '', []));
  const root = mkdtempSync(path.join(tmpdir(), 'silent-ctl-'));
  mkdirSync(path.join(root, 'eval/results'), { recursive: true });
  writeFileSync(path.join(root, 'eval/results/ledger.jsonl'), 'ZQabc');
  assert.throws(() => assertFilesClean('x', root, ['ZQabc'], []));
  mkdirSync(path.join(root, 'eval/results/locked'));
  writeFileSync(path.join(root, 'eval/results/locked/r.jsonl'), 'ZQout');
  assert.doesNotThrow(() => assertFilesClean('x', root, [], ['ZQout']));
});
