// Card-loading examples (llm-probe task 7.3; requirements 2.1 to 2.7, 3.2).
// The real dev split is loaded read-only. Everything else uses temporary directories built
// from dev lines with a custom LOCK.md. The real locked split is never loaded.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  CardLoadError,
  DEFAULT_CARDS_DIR,
  loadCards,
  parseVoidTable,
  type CardFailure,
} from '../../src/cards.ts';

const devLines = readFileSync(path.join(DEFAULT_CARDS_DIR, 'cards', 'dev.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

function lock(rows: { dev?: string; locked?: string }, voided = '| none | | |'): string {
  const row = (name: string, v: string | undefined): string => (v === undefined ? '' : `| ${name} | ${v} | 1 | 1 | 1 | 1 | x | \`h\` |\n`);
  return (
    '# Lock\n\n## Contents\n\n| Split | Cards | Scored D | Scored S | Sanity (unscored) | Scenario groups | Contrast pairs (D / S) | sha256 |\n|---|---|---|---|---|---|---|---|\n' +
    row('dev', rows.dev) +
    row('locked', rows.locked) +
    `\n## Voided cards\n\n| Date | Card | Reason |\n|---|---|---|\n${voided}\n`
  );
}

/** Contents row text for a list of lines: "total | d | s | sanity". */
function rowFor(lines: string[]): string {
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

function mk(files: { lock: string; dev?: string[]; locked?: string[] }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cards-'));
  mkdirSync(path.join(dir, 'cards'));
  writeFileSync(path.join(dir, 'LOCK.md'), files.lock);
  if (files.dev) writeFileSync(path.join(dir, 'cards', 'dev.jsonl'), files.dev.join('\n') + '\n');
  if (files.locked) writeFileSync(path.join(dir, 'cards', 'locked.jsonl'), files.locked.join('\n') + '\n');
  return dir;
}

function failures(fn: () => unknown): CardFailure[] {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof CardLoadError);
    return e.failures;
  }
  assert.fail('expected CardLoadError');
}

const withId = (line: string, id: string): string => JSON.stringify({ ...(JSON.parse(line) as object), id });

test('real dev split: 34 cards, 18 D, 12 S, 4 sanity, no void', () => {
  const r = loadCards({ cardsDir: DEFAULT_CARDS_DIR, splits: ['dev'] });
  assert.deepEqual(r.counts.dev, { total: 34, scored_decision: 18, scored_synthesis: 12, sanity: 4 });
  // The counts above equal the LOCK.md Contents row (loadCards parses it into `expected`).
  assert.deepEqual(r.expected.dev, { total: 34, scored_decision: 18, scored_synthesis: 12, sanity: 4 });
  assert.deepEqual(r.voidIds, []);
  assert.equal(r.cards.dev.filter((c) => c.void).length, 0);
  assert.equal(r.cards.locked.length, 0);
  assert.equal(r.all.length, 34);
  assert.equal(r.all[0]?.line, 1);
});

test('guard: no unit test loads the real locked split', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const self = path.basename(fileURLToPath(import.meta.url));
  const real = 'DEFAULT_CARDS_DIR';
  // A call on the real cards directory whose splits mention the locked split, or a path to the
  // real locked file. Synthetic temp directories are fine.
  const bad = [new RegExp(`cardsDir:\\s*${real}[^)]*['"]locked['"]`), new RegExp(`${real}[^)]*locked\\.jsonl`)];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const re of bad) assert.ok(!re.test(text), `${f} loads the real locked split`);
  }
  assert.ok(readdirSync(dir).includes(self));
});

test('count mismatch prints split, count name, expected and actual', () => {
  const dir = mk({ lock: lock({ dev: '5 | 1 | 1 | 1' }), dev: devLines.slice(0, 4) });
  try {
    const f = failures(() => loadCards({ cardsDir: dir, splits: ['dev'] }));
    const m = f.find((x) => x.kind === 'count_mismatch' && x.count === 'total');
    assert.deepEqual(m, { kind: 'count_mismatch', split: 'dev', count: 'total', expected: 5, actual: 4 });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('parse failure reports line number and Card ID when present', () => {
  const bad = devLines[1]!.replace('"tick":', '"tick":1.5,"x":');
  const lines = [devLines[0]!, '', bad];
  const dir = mk({ lock: lock({ dev: rowFor(devLines.slice(0, 2)) }), dev: lines });
  try {
    const f = failures(() => loadCards({ cardsDir: dir, splits: ['dev'] }));
    assert.equal(f.length, 1);
    const p = f[0]!;
    assert.equal(p.kind, 'parse_failure');
    if (p.kind === 'parse_failure') {
      assert.equal(p.line, 3);
      assert.equal(p.cardId, (JSON.parse(devLines[1]!) as { id: string }).id);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
  const dir2 = mk({ lock: lock({ dev: '1 | 1 | 0 | 0' }), dev: ['not json'] });
  try {
    const p = failures(() => loadCards({ cardsDir: dir2, splits: ['dev'] }))[0]!;
    assert.equal(p.kind, 'parse_failure');
    if (p.kind === 'parse_failure') assert.equal(p.cardId, undefined);
  } finally {
    rmSync(dir2, { recursive: true });
  }
});

test('duplicate IDs within and across splits report both line numbers', () => {
  const a = devLines.slice(0, 3);
  const dupWithin = [a[0]!, a[1]!, withId(a[2]!, (JSON.parse(a[0]!) as { id: string }).id)];
  const dir = mk({ lock: lock({ dev: rowFor(dupWithin) }), dev: dupWithin });
  try {
    const f = failures(() => loadCards({ cardsDir: dir, splits: ['dev'] }));
    assert.deepEqual(f[0], {
      kind: 'duplicate_id',
      id: (JSON.parse(a[0]!) as { id: string }).id,
      first: { split: 'dev', line: 1 },
      second: { split: 'dev', line: 3 },
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
  const locked = [withId(a[1]!, (JSON.parse(a[2]!) as { id: string }).id), withId(a[0]!, 'D-dream_interpretation-901')];
  const dir2 = mk({
    lock: lock({ dev: rowFor(a), locked: rowFor(locked) }),
    dev: a,
    locked,
  });
  try {
    const f = failures(() => loadCards({ cardsDir: dir2, splits: ['dev', 'locked'] }));
    const d = f[0]!;
    assert.equal(d.kind, 'duplicate_id');
    if (d.kind === 'duplicate_id') {
      assert.deepEqual(d.first, { split: 'dev', line: 3 });
      assert.deepEqual(d.second, { split: 'locked', line: 1 });
    }
    // A Dev_Run never reads locked.jsonl, so it does not see that duplicate.
    assert.doesNotThrow(() => loadCards({ cardsDir: dir2, splits: ['dev'] }));
  } finally {
    rmSync(dir2, { recursive: true });
  }
});

test('Dev_Run does not need locked.jsonl at all', () => {
  const dir = mk({ lock: lock({ dev: rowFor(devLines.slice(0, 3)) }), dev: devLines.slice(0, 3) });
  try {
    assert.equal(loadCards({ cardsDir: dir, splits: ['dev'] }).all.length, 3);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('void table: a listed card is marked void', () => {
  const three = devLines.slice(0, 3);
  const id = (JSON.parse(three[1]!) as { id: string }).id;
  const dir = mk({ lock: lock({ dev: rowFor(three) }, `| 2026-11-20 | ${id} | bad key |`), dev: three });
  try {
    const r = loadCards({ cardsDir: dir, splits: ['dev'] });
    assert.deepEqual(r.voidIds, [id]);
    assert.deepEqual(r.cards.dev.map((c) => c.void), [false, true, false]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('void table: unknown ID exits when both splits are loaded; deferred for a Dev_Run', () => {
  const three = devLines.slice(0, 3);
  const locked = [withId(three[0]!, 'D-dream_interpretation-901')];
  const dir = mk({
    lock: lock({ dev: rowFor(three), locked: rowFor(locked) }, '| 2026-11-20 | D-dream_interpretation-404 | typo |'),
    dev: three,
    locked,
  });
  try {
    const f = failures(() => loadCards({ cardsDir: dir, splits: ['dev', 'locked'] }));
    assert.deepEqual(f, [{ kind: 'void_unknown_id', id: 'D-dream_interpretation-404' }]);
    assert.deepEqual(loadCards({ cardsDir: dir, splits: ['dev'] }).unverifiedVoidIds, ['D-dream_interpretation-404']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('void table: missing table and malformed rows fail', () => {
  assert.deepEqual(parseVoidTable('# Lock\n\nnothing here\n'), { ok: false, failure: { kind: 'void_table_missing' } });
  for (const row of ['| 2026-11-20 | | no card |', '| | X-1 | no date |', '| 2026-11-20 | X-1 |', '| none | X-1 | odd |']) {
    const r = parseVoidTable(`## Voided cards\n\n| Date | Card | Reason |\n|---|---|---|\n${row}\n`);
    assert.equal(r.ok, false, row);
    if (!r.ok) assert.equal(r.failure.kind, 'void_row_malformed');
  }
  assert.deepEqual(parseVoidTable('## Voided cards\n\n| Date | Card | Reason |\n|---|---|---|\n| none | | |\n'), { ok: true, ids: [] });
});

test('LOCK.md without a Voided cards table fails the load', () => {
  const three = devLines.slice(0, 3);
  const text = lock({ dev: rowFor(three) }).split('## Voided cards')[0]!;
  const dir = mk({ lock: text, dev: three });
  try {
    assert.deepEqual(failures(() => loadCards({ cardsDir: dir, splits: ['dev'] })), [{ kind: 'void_table_missing' }]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
