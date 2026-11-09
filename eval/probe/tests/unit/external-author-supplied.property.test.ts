// Property 56 (llm-probe task 43.2): the Author-supplied External reference is shown only in section 12, with its label,
// and never touches a mark, the ledger, the budget or the Phase_2 branch.
// **Validates: Requirements 20.18, 20.19, 20.20, 19.16**
// The pinned examples read the real checked-in `eval/results/external/teacher-upper-bound/author-supplied.json` (read-only).
// The properties use temp directories and in-memory copies. No network, no `env`, no Locked_Card.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { AUTHOR_SUPPLIED_LABEL, parseAuthorSupplied, readAuthorSupplied, readExternalRecords } from '../../src/external.ts';
import { authorSuppliedLines, buildReport, type AuthorSuppliedView, type ReportInput } from '../../src/report.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RESULTS = path.join(REPO, 'eval/results');
const FILE = path.join(RESULTS, 'external/teacher-upper-bound/author-supplied.json');
const bytes = fs.readFileSync(FILE);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const real = (): Json => JSON.parse(bytes.toString('utf8')) as Json;

const REPORT_BASE: ReportInput = {
  generated_on: '2026-11-09',
  environment: { targetMachine: 'Test machine', workersEndpoint: null },
  state: { combinations: [], entries: [], failures: [], exclusions: [], smoke: [], approvals: { approved: true, approvals: [] } },
  lockedRuns: [],
  incompleteFaults: new Map(),
  devRuns: [],
  preflights: new Map(),
  runtimeLibraries: [],
};
const sectionsOf = (report: string): string[] => report.split(/\n(?=## )/);
const view = (): AuthorSuppliedView => readAuthorSupplied(RESULTS)[0] as AuthorSuppliedView;

test('pinned example: the checked-in file reads back with the figures exactly as supplied', () => {
  const [r, ...rest] = readAuthorSupplied(RESULTS);
  assert.equal(rest.length, 0);
  assert.ok(r !== undefined);
  assert.equal(r.verification, AUTHOR_SUPPLIED_LABEL);
  assert.equal(r.verification, 'Author-supplied, not verified by ingest');
  assert.equal(r.file_sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(r.evaluated_repo_head.full, '7b99dc85ecdbc8af605b9d286cb0df7ca324f9f6');
  assert.equal(r.archive.freeze_and_ledger_start_commit.short, '0ef13c0');
  assert.equal(r.archive.results_and_complete_commit.short, '732f0c6');
  assert.equal(r.frozen.manifest_sha256, '9322729c727a8c975dc3273fb7cc2f239e8790ea66e1745493179aea6815b34f');
  assert.equal(r.frozen.locked_sha256, 'd5abed2a80ce3f4150b5969b86ba48548c63f9ae2f9d93f0d6bb9a1934714083');
  assert.equal(r.frozen.wasm_sha256, 'a4bc56273b9675cc7813419f5eeb342ae1771481ab74b0418e6d6974feff6587');
  const [d, s] = r.tasks;
  assert.ok(d !== undefined && s !== undefined);
  assert.deepEqual([d.task_type, d.model, d.thinking, d.template, d.template_sha256], ['D', 'deepseek-v4.1-flash-1017', true, 'decision.teacher1.txt', '5c9372825cb05b2da992345507284a427ff18194b8feaf8fd8e876187c704a4b']);
  assert.deepEqual(d.figures, { acceptable: 58, scored_cards: 60, severe: 1, flips: 34, flip_perms: 172, consistent_pairs: 11, pairs: 15 });
  assert.equal(d.acceptable_cluster_lower_bound_tenths_pct, 915);
  assert.equal(d.archive_summary.truncated, 1, 'the archive summary shows truncated: 1, recorded as is');
  assert.deepEqual([s.task_type, s.model, s.thinking, s.template], ['S', 'kimi-k3', false, 'synthesis.v1']);
  assert.deepEqual(s.figures, { acceptable: 34, scored_cards: 40, severe: 0, flips: 7, flip_perms: 44, consistent_pairs: 8, pairs: 10 });
});

test('pinned example: section 12 shows the subsection with the label, the sha256 and the figures, and gives no verdict', () => {
  const v = view();
  const text = authorSuppliedLines(v).join('\n');
  assert.match(text, /### External reference: teacher-upper-bound \(Author-supplied, not verified by ingest\)/);
  assert.ok(text.includes(v.file_sha256));
  assert.match(text, /not a Locked_Run Combination of this repository/);
  assert.match(text, /\| Acceptable rate \| 58 of 60 \(96\.7%, cluster lower bound 91\.5%\) \|/);
  assert.match(text, /\| Flip rate \| 34 of 172 \(19\.8%\) \|/);
  assert.match(text, /\| Contrast consistency \| 11 of 15 pairs \|/);
  assert.match(text, /\| Acceptable rate \| 34 of 40 \(85\.0%\) \|/);
  assert.match(text, /\| Flip rate \| 7 of 44 \(15\.9%\) \|/);
  assert.match(text, /\| Contrast consistency \| 8 of 10 pairs \|/);
  assert.match(text, /truncated 1/);
  assert.match(text, /an analysis, not a judgement/);
  assert.ok(!/\b(pass|passes|passed|fail|fails|failed|failing)\b/i.test(text), 'the subsection states no Threshold verdict (RC-20 open)');
});

test('pinned example: the note on fine-tuning is in section 13 once and not repeated in section 12', () => {
  const report = buildReport({ ...REPORT_BASE, authorSupplied: [view()] });
  const secs = sectionsOf(report);
  assert.equal(secs.filter((s) => /fine-tuning small models and teacher tests/.test(s)).length, 1);
  assert.ok((secs.find((s) => s.startsWith('## 13. ')) ?? '').includes('fine-tuning small models and teacher tests'));
  assert.ok(!(secs.find((s) => s.startsWith('## 12. ')) ?? '').includes('fine-tuning'));
});

test('property: adding or removing the file changes section 12 only; every other section is byte-identical', () => {
  const v = view();
  const without = sectionsOf(buildReport({ ...REPORT_BASE, authorSupplied: [] }));
  const withIt = sectionsOf(buildReport({ ...REPORT_BASE, authorSupplied: [v] }));
  const s12 = withIt.find((s) => s.startsWith('## 12. ')) as string;
  assert.ok(s12.includes(AUTHOR_SUPPLIED_LABEL) && s12.includes(v.file_sha256));
  const others = withIt.filter((s) => !s.startsWith('## 12. '));
  assert.deepEqual(others, without.filter((s) => !s.startsWith('## 12. ')), 'marks, link marks, recommendations and the branch text do not change');
  for (const s of others) assert.ok(!/Author-supplied|teacher-upper-bound|External reference:/i.test(s), 'no other section mentions it');
});

test('property: the reader and the report writer touch no ledger, no budget, no results file and send no request', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'author-supplied-'));
  try {
    const dir = path.join(tmp, 'external/teacher-upper-bound');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'author-supplied.json'), bytes);
    fs.writeFileSync(path.join(tmp, 'ledger.jsonl'), '{"a":1}\n');
    const snapshot = (): string => [...fs.readdirSync(tmp, { recursive: true, withFileTypes: false })].sort().map((f) => `${f}:${fs.statSync(path.join(tmp, String(f))).isFile() ? createHash('sha256').update(fs.readFileSync(path.join(tmp, String(f)))).digest('hex') : 'dir'}`).join('\n');
    const before = snapshot();
    const realFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (() => {
      requests++;
      return Promise.reject(new Error('no request may be sent'));
    }) as typeof fetch;
    try {
      assert.equal(readAuthorSupplied(tmp).length, 1);
      assert.deepEqual(readExternalRecords(tmp), [], 'a directory with only an Author-supplied file is not an ingest record and does not make the ingest reader fail');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(requests, 0);
    assert.equal(snapshot(), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('property: the reader accepts exactly the well-formed files (hashes, integers, numerator at most denominator, label, members)', () => {
  assert.doesNotThrow(() => parseAuthorSupplied(real()));
  const hexArb = fc.stringMatching(/^[0-9a-f]{64}$/);
  const badHexArb = fc.oneof(fc.stringMatching(/^[0-9a-f]{0,63}$/), fc.stringMatching(/^[0-9A-F]{64}$/).filter((s) => /[A-F]/.test(s)), fc.stringMatching(/^[0-9a-f]{65}$/), fc.constant('zz'.repeat(32)));
  const hashPaths: readonly (readonly string[])[] = [
    ['archive', 'freeze_json_sha256'],
    ['archive', 'ledger_sha256'],
    ['frozen', 'manifest_sha256'],
    ['frozen', 'locked_sha256'],
    ['frozen', 'wasm_sha256'],
    ['tasks', '0', 'template_sha256'],
    ['tasks', '1', 'results_sha256'],
    ['tasks', '1', 'grades_sha256'],
  ];
  const setAt = (o: Json, p: readonly string[], v: unknown): Json => {
    const c = structuredClone(o);
    let cur: any = c; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const k of p.slice(0, -1)) cur = cur[k];
    cur[p[p.length - 1] as string] = v;
    return c;
  };
  fc.assert(
    fc.property(fc.constantFrom(...hashPaths), hexArb, badHexArb, (p, good, bad) => {
      assert.doesNotThrow(() => parseAuthorSupplied(setAt(real(), p, good)));
      assert.throws(() => parseAuthorSupplied(setAt(real(), p, bad)), /64 lowercase hexadecimal/);
    }),
    { numRuns: 100 },
  );
  fc.assert(
    fc.property(fc.constantFrom('acceptable', 'severe', 'flips', 'consistent_pairs'), fc.integer({ min: 1, max: 1000 }), (name, extra) => {
      const den = { acceptable: 'scored_cards', severe: 'scored_cards', flips: 'flip_perms', consistent_pairs: 'pairs' }[name] as string;
      const o = real();
      o['tasks'][0].figures[name] = o['tasks'][0].figures[den] + extra;
      assert.throws(() => parseAuthorSupplied(o), /must not exceed/);
    }),
    { numRuns: 60 },
  );
  fc.assert(
    fc.property(fc.constantFrom('acceptable', 'scored_cards', 'severe', 'flips', 'flip_perms', 'consistent_pairs', 'pairs'), fc.oneof(fc.integer({ min: -1000, max: -1 }), fc.double({ noNaN: true }).filter((x) => !Number.isInteger(x)), fc.constant('7')), (name, bad) => {
      const o = real();
      o['tasks'][1].figures[name] = bad;
      assert.throws(() => parseAuthorSupplied(o), /non-negative whole number/);
    }),
    { numRuns: 60 },
  );
  fc.assert(
    fc.property(fc.string({ maxLength: 60 }).filter((s) => s !== AUTHOR_SUPPLIED_LABEL), (label) => {
      const o = real();
      o['verification'] = label;
      assert.throws(() => parseAuthorSupplied(o), /verification must read/);
    }),
    { numRuns: 60 },
  );
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z_]{1,12}$/).filter((k) => !(k in real())), fc.string({ maxLength: 20 }), (key, val) => {
      const o = real();
      o[key] = val;
      assert.throws(() => parseAuthorSupplied(o), /is not a member of the format/);
    }),
    { numRuns: 60 },
  );
  const noRepoFlag = real();
  noRepoFlag['is_repo_combination'] = true;
  assert.throws(() => parseAuthorSupplied(noRepoFlag), /is_repo_combination must be false/);
});

test('property: the checked-in file holds no Card content: only hashes, model and template names, run IDs and integers', () => {
  const o = real();
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
  };
  walk(o);
  for (const s of strings) assert.ok(!/\b[DS]-(?:locked|dev|sanity)-\d+/i.test(s) && !/\bP\d{3}\b/.test(s), `no Card ID or pair_id in ${s}`);
  for (const t of o['tasks']) for (const n of Object.values(t.figures)) assert.ok(Number.isSafeInteger(n));
});
