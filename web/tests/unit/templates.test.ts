// Feature: first-playable, Property 26: Template text is a pure function of the Snapshot
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { chronicleLines, sceneLines, EMPTY_CHRONICLE } from '../../src/main/templates.ts';
import { initialUiState } from '../../src/main/ui-state.ts';
import type { ChronicleEntry, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const RUNS = 1000;
const base: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
const entryArb: fc.Arbitrary<ChronicleEntry> = fc.record({
  tick: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(String),
  family: fc.constantFrom('family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'),
  stakes: fc.record({ who: fc.uniqueArray(fc.constantFrom(...base.residents.map(person => person.id)), { minLength: 1, maxLength: 4 }),
    amount: fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map(String),
    unit: fc.constantFrom('money', 'joss_paper', 'affinity', 'trait_points'),
    by: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(String) }),
  applied: fc.constantFrom('keep_it', 'repay_now', 'apologize', 'help_at_home', 'stay_away'),
  source: fc.constantFrom('external', 'rules_default', 'auto_resolved'),
  chooser_absent: fc.boolean(), skipped: fc.constant([]),
});

test('Property 26: repeated templates preserve every Snapshot fact and newest-first order', () => {
  fc.assert(fc.property(fc.array(entryArb, { minLength: 0, maxLength: 100 }), (chronicle) => {
    const world = { ...base, chronicle };
    const ui = { ...initialUiState(), world };
    const before = JSON.stringify(ui);
    const lines = chronicleLines(ui);
    assert.deepEqual(chronicleLines(ui), lines);
    const ordered = chronicle.map((entry, index) => ({ entry, index })).sort((a, b) =>
      BigInt(a.entry.tick) > BigInt(b.entry.tick) ? -1 : BigInt(a.entry.tick) < BigInt(b.entry.tick) ? 1 : b.index - a.index);
    assert.deepEqual(lines, ordered.map(({ entry }) => `Tick ${entry.tick} · ${entry.family} · ${entry.stakes.who.map(id => base.residents.find(person => person.id === id)!.name).join(', ')}; ${entry.stakes.amount} ${entry.stakes.unit}; by tick ${entry.stakes.by} · ${entry.applied} · ${entry.source}`));
    for (const kind of ['funeral', 'inheritance', 'dream', 'birth'] as const) {
      assert.deepEqual(sceneLines(kind, ui.world), sceneLines(kind, ui.world));
    }
    assert.equal(JSON.stringify(ui), before);
  }), { numRuns: RUNS });
});

test('Chronicle tie order, non-resident names and fixed empty-state text', () => {
  const entry: ChronicleEntry = { tick: '9007199254740993', family: 'inheritance',
    stakes: { who: [100], amount: '9007199254740995', unit: 'money', by: '9007199254740996' }, applied: 'keep_it', source: 'external', chooser_absent: false, skipped: [] };
  const world = { ...base, person_names: [{ id: 100, name: 'Remembered Person' }], chronicle: [entry, { ...entry, applied: 'thank_family' as const }] };
  const lines = chronicleLines({ ...initialUiState(), world });
  assert.match(lines[0]!, /thank_family/);
  assert.match(lines[1]!, /Remembered Person; 9007199254740995 money; by tick 9007199254740996/);
  assert.deepEqual(chronicleLines(initialUiState()), []);
  assert.deepEqual(chronicleLines({ ...initialUiState(), world: base }), []);
  assert.equal(EMPTY_CHRONICLE, 'Nothing has been written yet.');
});

test('Scene text uses named Snapshot facts and no third-party trademarks', () => {
  const world = { ...base, player_node: { id: '1', family: 'inheritance' as const, fired: '499', choice_tick: '500', resolves: '500',
    stakes: { who: [1, 2], amount: '640', unit: 'money' as const, by: '501' }, options: [], rules_default: 'keep_it' as const } };
  assert.deepEqual(sceneLines('inheritance', world), ['John Carlson, Irene Carlson · inheritance · 640 money · by tick 501']);
  assert.deepEqual(sceneLines('birth', world), ['Irene Carlson · a new life · tick 500']);
  assert.deepEqual(sceneLines('dream', world), ['A dream reaches the town · tick 500']);
  assert.doesNotMatch(readFileSync(new URL('../../src/main/templates.ts', import.meta.url), 'utf8'), /\b(?:Kenney|Nintendo|Disney|Pokemon|Pokémon|Microsoft|Apple|Google)\b/i);
});
