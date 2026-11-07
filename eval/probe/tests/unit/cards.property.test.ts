// Feature: llm-probe, Property 17: Card loading finds duplicates and reads the void table
// Validates: Requirements 2.4, 2.5, 2.6, 2.7
//
// Every case builds a temporary card directory from DEV card lines only (re-ID'd). The
// synthetic "locked" split is also made from re-ID'd dev lines, with a temporary LOCK.md whose
// Contents table matches the synthetic counts. The real locked split is never read.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { CardLoadError, DEFAULT_CARDS_DIR, loadCards, type CardFailure, type Split } from '../../src/cards.ts';

const devLines = readFileSync(path.join(DEFAULT_CARDS_DIR, 'cards', 'dev.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

const idOf = (g: number): string => `D-dream_interpretation-${100 + g}`; // three digits only
const withId = (line: string, id: string): string => JSON.stringify({ ...(JSON.parse(line) as object), id });
/** Line i of a synthetic split: a dev line (cycled, offset per split) with the given group's ID. */
const mkLine = (i: number, offset: number, g: number): string =>
  withId(devLines[(i + offset) % devLines.length]!, idOf(g));

function countsRow(lines: string[]): number[] {
  let d = 0;
  let s = 0;
  let z = 0;
  for (const l of lines) {
    const c = JSON.parse(l) as { task: string; scored: boolean };
    if (!c.scored) z++;
    else if (c.task === 'decision') d++;
    else s++;
  }
  return [lines.length, d, s, z];
}

function lockText(
  rows: { dev: number[]; locked?: number[] },
  voidSection: string | undefined,
): string {
  const row = (name: string, v: number[] | undefined): string =>
    v === undefined ? '' : `| ${name} | ${v.join(' | ')} | 1 | 1 / 1 | \`h\` |\n`;
  return (
    '# Lock\n\n## Contents\n\n| Split | Cards | Scored D | Scored S | Sanity | Groups | Pairs | sha256 |\n|---|---|---|---|---|---|---|---|\n' +
    row('dev', rows.dev) +
    row('locked', rows.locked) +
    (voidSection === undefined ? '' : `\n## Voided cards\n\n| Date | Card | Reason |\n|---|---|---|\n${voidSection}\n`)
  );
}

function withDir<T>(
  lock: string,
  dev: string[],
  locked: string[] | undefined,
  fn: (dir: string) => T,
): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'cards-prop-'));
  try {
    mkdirSync(path.join(dir, 'cards'));
    writeFileSync(path.join(dir, 'LOCK.md'), lock);
    writeFileSync(path.join(dir, 'cards', 'dev.jsonl'), dev.join('\n') + '\n');
    if (locked !== undefined) writeFileSync(path.join(dir, 'cards', 'locked.jsonl'), locked.join('\n') + '\n');
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

function failuresOf(dir: string, splits: Split[]): CardFailure[] | undefined {
  try {
    loadCards({ cardsDir: dir, splits });
  } catch (e) {
    assert.ok(e instanceof CardLoadError);
    return e.failures;
  }
  return undefined;
}

const NONE_ROW = '| none | | |';
const runs = { numRuns: 30 };

// Group numbers pick the ID of each line; a repeated group is an injected duplicate.
const groupsArb = (max: number, len: [number, number]): fc.Arbitrary<number[]> =>
  fc.array(fc.nat(max), { minLength: len[0], maxLength: len[1] });

test('Property 17: duplicate IDs within and across splits are all reported with both lines', () => {
  fc.assert(
    fc.property(groupsArb(7, [1, 6]), groupsArb(7, [0, 4]), (devG, lockedG) => {
      const dev = devG.map((g, i) => mkLine(i, 0, g));
      const locked = lockedG.map((g, i) => mkLine(i, 12, g));
      const useLocked = lockedG.length > 0;
      const expected: CardFailure[] = [];
      const firstSeen = new Map<number, { split: Split; line: number }>();
      const seq: { g: number; split: Split; line: number }[] = [
        ...devG.map((g, i) => ({ g, split: 'dev' as const, line: i + 1 })),
        ...(useLocked ? lockedG.map((g, i) => ({ g, split: 'locked' as const, line: i + 1 })) : []),
      ];
      for (const e of seq) {
        const first = firstSeen.get(e.g);
        if (first === undefined) firstSeen.set(e.g, { split: e.split, line: e.line });
        else
          expected.push({
            kind: 'duplicate_id',
            id: idOf(e.g),
            first,
            second: { split: e.split, line: e.line },
          });
      }
      const lock = lockText({ dev: countsRow(dev), ...(useLocked ? { locked: countsRow(locked) } : {}) }, NONE_ROW);
      withDir(lock, dev, useLocked ? locked : undefined, (dir) => {
        const got = failuresOf(dir, useLocked ? ['dev', 'locked'] : ['dev']);
        if (expected.length === 0) assert.equal(got, undefined);
        else assert.deepEqual(got, expected);
        // A Dev_Run never opens locked.jsonl, so it sees only duplicates inside dev.
        const devOnly = expected.filter((f) => f.kind === 'duplicate_id' && f.second.split === 'dev');
        const gotDev = failuresOf(dir, ['dev']);
        if (devOnly.length === 0) assert.equal(gotDev, undefined);
        else assert.deepEqual(gotDev, devOnly);
      });
    }),
    runs,
  );
});

// Unique IDs 0..n-1 in dev, 100..100+m-1 in locked.
function uniqueSets(n: number, m: number): { dev: string[]; locked: string[] } {
  return {
    dev: Array.from({ length: n }, (_, i) => mkLine(i, 0, i)),
    locked: Array.from({ length: m }, (_, i) => mkLine(i, 12, 100 + i)),
  };
}

const fmtCell = (id: string, ticks: boolean): string => (ticks ? `\`${id}\`` : id);

test('Property 17: void table rows name exactly the void cards; none row is empty', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 3 }),
      fc.array(fc.tuple(fc.nat(7), fc.boolean()), { maxLength: 5 }),
      fc.boolean(),
      (n, m, picks, addNone) => {
        const { dev, locked } = uniqueSets(n, m);
        const all = [
          ...Array.from({ length: n }, (_, i) => idOf(i)),
          ...Array.from({ length: m }, (_, i) => idOf(100 + i)),
        ];
        const named = picks.map(([k, t]) => ({ id: all[k % all.length]!, ticks: t }));
        const rows = named.map((p) => `| 2026-11-20 | ${fmtCell(p.id, p.ticks)} | reason |`);
        if (named.length === 0 || addNone) rows.push(NONE_ROW);
        const lock = lockText({ dev: countsRow(dev), locked: countsRow(locked) }, rows.join('\n'));
        const want = [...new Set(named.map((p) => p.id))];
        withDir(lock, dev, locked, (dir) => {
          const r = loadCards({ cardsDir: dir, splits: ['dev', 'locked'] });
          assert.deepEqual(new Set(r.voidIds), new Set(want));
          assert.equal(r.voidIds.length, want.length);
          assert.deepEqual(new Set(r.all.filter((c) => c.void).map((c) => c.id)), new Set(want));
          assert.deepEqual(r.unverifiedVoidIds, []);
          // Dev_Run: IDs of the unread locked split are unverified, never void.
          const d = loadCards({ cardsDir: dir, splits: ['dev'] });
          const devIds = new Set(dev.map((_, i) => idOf(i)));
          assert.deepEqual(new Set(d.voidIds), new Set(want.filter((id) => devIds.has(id))));
          assert.deepEqual(new Set(d.unverifiedVoidIds), new Set(want.filter((id) => !devIds.has(id))));
        });
      },
    ),
    runs,
  );
});

test('Property 17: unknown void IDs fail exactly when both splits are loaded (R2.7)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.uniqueArray(fc.integer({ min: 500, max: 520 }), { minLength: 1, maxLength: 4 }),
      fc.boolean(),
      (n, unknown, withKnown) => {
        const { dev, locked } = uniqueSets(n, 2);
        const ids = unknown.map(idOf);
        const rows = ids.map((id) => `| 2026-11-20 | ${id} | typo |`);
        if (withKnown) rows.push(`| 2026-11-20 | ${idOf(0)} | real |`);
        const lock = lockText({ dev: countsRow(dev), locked: countsRow(locked) }, rows.join('\n'));
        withDir(lock, dev, locked, (dir) => {
          assert.deepEqual(
            failuresOf(dir, ['dev', 'locked']),
            ids.map((id) => ({ kind: 'void_unknown_id', id })),
          );
          assert.deepEqual(failuresOf(dir, ['dev']), undefined);
        });
      },
    ),
    runs,
  );
});

test('Property 17: a missing table or a malformed row fails the load', () => {
  const malformed = (id: string): string[] => [
    '| 2026-11-20 | | no card |',
    `| | ${id} | no date |`,
    `| 2026-11-20 | ${id} |`,
    `| none | ${id} | odd |`,
    `| 2026-11-20 | ${id} extra | space in id |`,
  ];
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.nat(4),
      fc.array(fc.nat(3), { maxLength: 2 }),
      fc.nat(2),
      fc.boolean(),
      (n, badIdx, goodPicks, pos, missing) => {
        const { dev } = uniqueSets(n, 0);
        let section: string | undefined;
        let expected: CardFailure;
        if (missing) {
          section = undefined;
          expected = { kind: 'void_table_missing' };
        } else {
          const bad = malformed(idOf(0))[badIdx]!;
          const good = goodPicks.map((k) => `| 2026-11-20 | ${idOf(k % n)} | ok |`);
          const rows = [...good];
          rows.splice(Math.min(pos, rows.length), 0, bad);
          section = rows.join('\n');
          expected = { kind: 'void_row_malformed', row: bad };
        }
        withDir(lockText({ dev: countsRow(dev) }, section), dev, undefined, (dir) => {
          assert.deepEqual(failuresOf(dir, ['dev']), [expected]);
        });
      },
    ),
    runs,
  );
});

test('Property 17: count mismatches are reported exactly', () => {
  const names = ['total', 'scored_decision', 'scored_synthesis', 'sanity'] as const;
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (n, which, delta) => {
        const { dev } = uniqueSets(n, 0);
        const row = countsRow(dev);
        const actual = row[which]!;
        row[which] = actual + delta;
        withDir(lockText({ dev: row }, NONE_ROW), dev, undefined, (dir) => {
          assert.deepEqual(failuresOf(dir, ['dev']), [
            { kind: 'count_mismatch', split: 'dev', count: names[which]!, expected: actual + delta, actual },
          ]);
        });
      },
    ),
    runs,
  );
});
