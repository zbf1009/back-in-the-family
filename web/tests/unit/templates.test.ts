// Feature: first-playable, Property 26: Template text is a pure function of the Snapshot
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { chronicleLines, sceneLines, sceneStaging, EMPTY_CHRONICLE, type SceneKind } from '../../src/main/templates.ts';
import { initialUiState } from '../../src/main/ui-state.ts';
import type { ChronicleEntry, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { townDrawList } from '../../src/main/town-layout.ts';
import { pendingSnapshot, snapshot, waitingSnapshot } from './helpers/view.ts';

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
    assert.deepEqual(lines, ordered.map(({ entry }) => `Tick ${entry.tick} · ${entry.family} · ${entry.stakes.who.map(id => base.residents.find(person => person.id === id)!.name).join(', ')}; ${entry.stakes.amount} ${entry.stakes.unit}; by tick ${entry.stakes.by} · ${entry.applied} · ${entry.source} · chooser absent: ${entry.chooser_absent ? 'yes' : 'no'} · skipped: none`));
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

test('Chronicle consumers receive actual skipped parts and chooser absence with every named participant', () => {
  const names = ['Alexandra Alexandra Alexandra — first named participant', 'Alexandra Alexandra Alexandra — second named participant'];
  const entry: ChronicleEntry = { tick: '18446744073709551615', family: 'debt_due',
    stakes: { who: [100, 101], amount: '-9223372036854775808', unit: 'money', by: '18446744073709551615' },
    applied: 'repay_now', source: 'auto_resolved', chooser_absent: true,
    skipped: [{ part: 0, reason: 'missing_debt' }, { part: 2, reason: 'insufficient_money' }] };
  const world = { ...base, person_names: names.map((name, index) => ({ id: 100 + index, name })), chronicle: [entry] };
  const before = JSON.stringify(world);
  const line = chronicleLines({ ...initialUiState(), world })[0]!;
  for (const name of names) assert.ok(line.includes(name));
  assert.ok(line.includes(entry.tick));
  assert.ok(line.includes(entry.stakes.amount));
  assert.ok(line.includes(entry.applied));
  assert.ok(line.includes(entry.source));
  for (const part of entry.skipped) assert.ok(line.includes(`${part.part}: ${part.reason}`));
  const present = chronicleLines({ ...initialUiState(), world: { ...world, chronicle: [{ ...entry, chooser_absent: false }] } })[0]!;
  assert.notEqual(present, line, 'Chooser absence is a distinct reported outcome fact');
  assert.equal(JSON.stringify(world), before);
});

test('Scene text uses named Snapshot facts and no third-party trademarks', () => {
  const world = pendingSnapshot('inheritance');
  assert.deepEqual(sceneLines('inheritance', world), ['Deceased Resident left you 640 money · tick 499', 'Co-heirs named: John Carlson, Martha Carlson']);
  assert.deepEqual(sceneLines('birth', snapshot), ['You are Irene Carlson now · native · age 37', 'Household 1: John Carlson, Martha Carlson']);
  assert.deepEqual(sceneLines('dream', { ...snapshot, last_dream: { tick: '499', dreamer: 1, applied: 'heed_warning' } }),
    ['John Carlson dreamt of you · tick 499', 'They took the warning to heart.']);
  assert.doesNotMatch(readFileSync(new URL('../../src/main/templates.ts', import.meta.url), 'utf8'), /\b(?:Kenney|Nintendo|Disney|Pokemon|Pokémon|Microsoft|Apple|Google)\b/i);
});

test('Property 26: scene staging draws only named living people in line order with canonical tints', () => {
  fc.assert(fc.property(fc.constantFrom<SceneKind>('funeral', 'inheritance', 'dream', 'birth'), fc.boolean(),
    fc.bigInt({ min: 1n, max: 2n ** 64n - 1n }), (kind, own, tick) => {
      let world: WorldSnapshot;
      let expected: number[];
      if (kind === 'funeral') { world = own ? waitingSnapshot() : pendingSnapshot('family_death'); expected = own ? [] : [1]; }
      else if (kind === 'inheritance') { world = pendingSnapshot('inheritance'); expected = [1, 3]; }
      else if (kind === 'birth') { world = own ? waitingSnapshot() : snapshot; expected = own ? [] : [2, 1, 3]; }
      else {
        world = { ...snapshot, last_dream: { tick: String(tick), dreamer: 1, applied: 'take_comfort' } };
        expected = own ? [] : [1];
        if (own) world = { ...world, residents: world.residents.filter(person => person.id !== 1),
          households: world.households.map(house => ({ ...house, members: house.members.filter(id => id !== 1) })),
          person_names: [{ id: 1, name: 'John Carlson' }] };
      }
      const before = JSON.stringify(world);
      const lines = sceneLines(kind, world);
      assert.deepEqual(sceneLines(kind, world), lines);
      const stage = sceneStaging(kind, world);
      assert.deepEqual(sceneStaging(kind, world), stage);
      assert.deepEqual(stage.people, expected);
      const props = { funeral: ['coffin', 'candle'], inheritance: ['will'], dream: ['cloud'], birth: ['cradle'] };
      assert.deepEqual(stage.props, props[kind]);
      const town = townDrawList(world);
      for (const marker of stage.markers) {
        const person = world.residents.find(person => person.id === marker.person)!;
        assert.ok(person.alive);
        assert.ok(lines.some(line => line.includes(person.name)));
        const canonical = town.residents.find(person => person.person === marker.person)!;
        assert.equal(marker.tint, canonical.tint);
        assert.equal(marker.soul, canonical.soul);
      }
      assert.equal(new Set(stage.markers.map(marker => `${marker.x},${marker.y}`)).size, expected.length);
      assert.equal(JSON.stringify(world), before);
    }), { numRuns: RUNS });
});

test('Funerals select this death only, omit an absent mourner line, and name no attendance', () => {
  const world = waitingSnapshot();
  world.player.earlier_bodies = [...world.player.earlier_bodies, { id: 99, name: 'Older Body', origin: 'rebuilt', death: '10' }];
  world.player.past_life_ties = [...world.player.past_life_ties, { rememberer: 1, earlier_body: 99, affinity: 80 }];
  assert.deepEqual(sceneLines('funeral', world), ['Irene Carlson has died · tick 499', 'Remembered by 2 of the living.']);
  assert.deepEqual(sceneStaging('funeral', world).people, []);
  const node = pendingSnapshot('family_death');
  assert.deepEqual(sceneLines('funeral', node), ['Deceased Resident has died · tick 499', 'Also in this choice: John Carlson']);
  node.player_node = { ...node.player_node!, stakes: { ...node.player_node!.stakes, who: [100] } };
  assert.deepEqual(sceneLines('funeral', node), ['Deceased Resident has died · tick 499']);
});

test('Own and node funeral cues remain distinct in a joined constructed stop', () => {
  const world = waitingSnapshot();
  world.player_node = pendingSnapshot('family_death').player_node;
  world.person_names = [{ id: 100, name: 'Deceased Resident' }];
  assert.deepEqual(sceneLines({ kind: 'funeral', node: null }, world), ['Irene Carlson has died · tick 499', 'Remembered by 2 of the living.']);
  assert.deepEqual(sceneLines({ kind: 'funeral', node: '12' }, world), ['Deceased Resident has died · tick 499', 'Also in this choice: John Carlson']);
  assert.deepEqual(sceneStaging({ kind: 'funeral', node: '12' }, world).people, [1]);
});

test('Every dream interpretation uses its exact fixed line and a dead dreamer gets no marker', () => {
  const outcomes = {
    heed_warning: 'They took the warning to heart.', take_comfort: 'They took comfort from it.',
    follow_urging: 'They did what the dream urged.', believe_revelation: 'They believed what it revealed.',
    obey_ban: 'They obeyed the ban.', burn_offering: 'They burned joss paper for you.',
    burn_small: 'They burned a small bundle of joss paper for you.', dismiss_dream: 'They dismissed it and went on with the day.',
  } as const;
  for (const applied of Object.keys(outcomes) as (keyof typeof outcomes)[]) {
    const world = { ...snapshot, last_dream: { tick: '499', dreamer: 100, applied }, person_names: [{ id: 100, name: 'Deceased Dreamer' }] };
    assert.deepEqual(sceneLines('dream', world), ['Deceased Dreamer dreamt of you · tick 499', outcomes[applied]]);
    assert.deepEqual(sceneStaging('dream', world).people, []);
  }
});

test('Birth has no event tick, covers an empty household and the body that died in the same tick', () => {
  const world = { ...snapshot, households: snapshot.households.map(house => house.id === '1' ? { ...house, members: [2] } : house) };
  assert.deepEqual(sceneLines('birth', world), ['You are Irene Carlson now · native · age 37', 'Household 1: no one else.']);
  assert.deepEqual(sceneLines('birth', waitingSnapshot()), ['You were Irene Carlson · native']);
  assert.deepEqual(sceneStaging('birth', waitingSnapshot()).props, ['cradle']);
  assert.deepEqual(sceneStaging('birth', waitingSnapshot()).people, []);
});
