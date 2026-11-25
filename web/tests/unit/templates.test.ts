// Feature: first-playable, Property 26: Template text is a pure function of the Snapshot
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { chronicleLines, sceneLines, sceneStaging, EMPTY_CHRONICLE, type SceneKind } from '../../src/main/templates.ts';
import { initialUiState } from '../../src/main/ui-state.ts';
import type { ChronicleEntry, PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { townDrawList } from '../../src/main/town-layout.ts';
import { pendingSnapshot, snapshot, waitingSnapshot } from './helpers/view.ts';

const RUNS = 1000;
const base: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
function bodyFact(world: WorldSnapshot, kind: PlayerLifecycleFact['kind'], tick = world.tick): PlayerLifecycleFact {
  const body = world.residents.find(person => person.id === world.player.body) ?? world.player.earlier_bodies[0]!;
  return { event: '9007199254740993', tick, kind, body: body.id, name: body.name, origin: body.origin };
}
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

test('Scene text uses named Snapshot facts', () => {
  const world = pendingSnapshot('inheritance');
  assert.deepEqual(sceneLines('inheritance', world), ['Deceased Resident left you 640 money · tick 499', 'Co-heirs named: John Carlson, Martha Carlson']);
  const birth = bodyFact(snapshot, 'birth');
  assert.deepEqual(sceneLines({ kind: 'birth', node: null, lifecycle: birth }, snapshot), [`${birth.name} was born · biological birth at tick ${birth.tick}`, `Body ${birth.body} · ${birth.origin} · event ${birth.event}`]);
  assert.deepEqual(sceneLines('dream', { ...snapshot, last_dream: { tick: '499', dreamer: 1, applied: 'heed_warning' } }),
    ['John Carlson dreamt of you · tick 499', 'They took the warning to heart.']);
});

test('Property 26: scene staging draws only named living people in line order with canonical tints', () => {
  fc.assert(fc.property(fc.constantFrom<SceneKind>('funeral', 'inheritance', 'dream', 'birth'), fc.boolean(),
    fc.bigInt({ min: 1n, max: 2n ** 64n - 1n }), (kind, own, tick) => {
      let world: WorldSnapshot;
      let expected: number[];
      let cue: Parameters<typeof sceneLines>[0] = kind;
      if (kind === 'funeral') {
        world = own ? waitingSnapshot() : pendingSnapshot('family_death'); expected = own ? [] : [1];
        if (own) cue = { kind, node: null, lifecycle: bodyFact(world, 'death', String(tick)) };
      }
      else if (kind === 'inheritance') { world = pendingSnapshot('inheritance'); expected = [1, 3]; }
      else if (kind === 'birth') {
        world = own ? waitingSnapshot() : snapshot; expected = own ? [] : [2];
        cue = { kind, node: null, lifecycle: bodyFact(world, 'birth', String(tick)) };
      }
      else {
        world = { ...snapshot, last_dream: { tick: String(tick), dreamer: 1, applied: 'take_comfort' } };
        expected = own ? [] : [1];
        if (own) world = { ...world, residents: world.residents.filter(person => person.id !== 1),
          households: world.households.map(house => ({ ...house, members: house.members.filter(id => id !== 1) })),
          person_names: [{ id: 1, name: 'John Carlson' }] };
      }
      const before = JSON.stringify(world);
      const lines = sceneLines(cue, world);
      assert.deepEqual(sceneLines(cue, world), lines);
      const stage = sceneStaging(cue, world);
      assert.deepEqual(sceneStaging(cue, world), stage);
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
  const death = bodyFact(world, 'death', '499');
  const cue = { kind: 'funeral' as const, node: null, lifecycle: death };
  assert.deepEqual(sceneLines(cue, world), ['Irene Carlson has died · tick 499', `Body ${death.body} · native · event ${death.event}`, 'Remembered by 2 of the living.']);
  assert.deepEqual(sceneStaging(cue, world).people, []);
  const node = pendingSnapshot('family_death');
  assert.deepEqual(sceneLines('funeral', node), ['Deceased Resident has died · tick 499', 'Also in this choice: John Carlson']);
  node.player_node = { ...node.player_node!, stakes: { ...node.player_node!.stakes, who: [100] } };
  assert.deepEqual(sceneLines('funeral', node), ['Deceased Resident has died · tick 499']);
});

test('Own and node funeral cues remain distinct in a joined constructed stop', () => {
  const world = waitingSnapshot();
  world.player_node = pendingSnapshot('family_death').player_node;
  world.person_names = [{ id: 100, name: 'Deceased Resident' }];
  const death = bodyFact(world, 'death', '499');
  assert.deepEqual(sceneLines({ kind: 'funeral', node: null, lifecycle: death }, world), ['Irene Carlson has died · tick 499', `Body ${death.body} · native · event ${death.event}`, 'Remembered by 2 of the living.']);
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

test('Birth uses biological event tick and historical body facts without inventing current household or age', () => {
  const world = { ...snapshot, households: snapshot.households.map(house => house.id === '1' ? { ...house, members: [2] } : house) };
  const birth = bodyFact(world, 'birth', '100');
  const cue = { kind: 'birth' as const, node: null, lifecycle: birth };
  assert.deepEqual(sceneLines(cue, world), ['Irene Carlson was born · biological birth at tick 100', `Body ${birth.body} · native · event ${birth.event}`]);
  assert.deepEqual(sceneLines(cue, waitingSnapshot()), ['Irene Carlson was born · biological birth at tick 100', `Body ${birth.body} · native · event ${birth.event}`, 'This event-associated body subsequently died at tick 499.']);
  assert.deepEqual(sceneStaging(cue, waitingSnapshot()).props, ['cradle']);
  assert.deepEqual(sceneStaging(cue, waitingSnapshot()).people, []);
  assert.deepEqual(sceneLines('birth', world), [], 'Current body cannot manufacture historical Birth');
  assert.deepEqual(sceneLines('funeral', waitingSnapshot()), [], 'Waiting ghost cannot manufacture historical Death');
});

test('LV-C4 lifecycle templates use the actual event body rather than the latest ghost or earlier-body ordering', () => {
  const world = waitingSnapshot();
  world.player.earlier_bodies.unshift({ id: 200, name: 'Unrelated latest body', origin: 'native', death: '500' });
  world.player_wait!.ghost = 200;
  world.player.earlier_bodies.push({ id: 201, name: 'Stale retained label', origin: 'possessed', death: '500' });
  const arrival = { event: '18446744073709551614', tick: '499', kind: 'possession' as const, body: 201, name: 'Actual event-associated name', origin: 'possessed' as const };
  const death = { ...arrival, event: '18446744073709551615', tick: '500', kind: 'death' as const };
  const arrivalLines = sceneLines({ kind: 'birth', node: null, lifecycle: arrival }, world);
  const deathLines = sceneLines({ kind: 'funeral', node: null, lifecycle: death }, world);
  for (const [lines, fact] of [[arrivalLines, arrival], [deathLines, death]] as const) {
    assert.ok(lines.some(line => line.includes(fact.name)));
    assert.ok(lines.some(line => line.includes(fact.event)));
    assert.ok(lines.some(line => line.includes(String(fact.body))));
    assert.ok(!lines.some(line => line.includes('Unrelated latest body') || line.includes('Stale retained label')));
  }
  assert.ok(arrivalLines.some(line => line.includes('not biological birth')));
  assert.ok(!arrivalLines.some(line => /age\s+0|newborn|You are .* now/.test(line)));
  assert.equal(world.player.place, 'waiting');
});
