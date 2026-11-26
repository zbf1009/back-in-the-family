// Feature: first-playable, Property 24: Displayed values are the Snapshot's values
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { feedbackView, identitySummary, viewModel, namesById } from '../../src/main/view-model.ts';
import { currentDecision, initialUiState, reduce } from '../../src/main/ui-state.ts';
import { sceneQueue } from '../../src/main/scene-queue.ts';
import type { PlayerOption, Preview, StakeUnit, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

import { pendingSnapshot, uiFor, waitingSnapshot } from './helpers/view.ts';
const RUNS = 1000;
const base: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
const integer = fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map(String);
const tick = fc.bigInt({ min: 1n, max: 2n ** 64n - 2n });
const what = fc.constantFrom<Preview['what']>('money', 'debt', 'affinity', 'trait:greed', 'trait:loyalty', 'trait:pride', 'trait:warmth', 'trait:temper', 'trait:vindictiveness', 'trait:piety');
const previews = fc.array(fc.record({ person: fc.constantFrom(...base.residents.map(person => person.id)), what, delta: integer }), { minLength: 1, maxLength: 5 });
const needed = fc.array(fc.oneof(
  tick.map(tick => ({ kind: 'wait_until' as const, tick: String(tick) })),
  fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(amount => ({ kind: 'joss_short' as const, amount: String(amount) })),
  fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(amount => ({ kind: 'cap_room_short' as const, amount: String(amount) })),
  fc.constantFrom('claim_held', 'claimed_by_you', 'slot_closed').map(name => ({ kind: 'named' as const, name })),
), { minLength: 1, maxLength: 8 });


test('Property 24: Snapshot whole years, signed previews, Stakes and Needed remain exact', () => {
  fc.assert(fc.property(tick, fc.nat({ max: 10000 }), integer, fc.constantFrom<StakeUnit>('money', 'joss_paper', 'affinity', 'trait_points'), previews, needed,
    (now, age, amount, unit, preview, missing) => {
      const options: PlayerOption[] = ['repay_now', 'ask_for_time', 'ignore_it'];
      const world: WorldSnapshot = { ...base, tick: String(now),
        residents: base.residents.map(person => person.id === base.player.body ? { ...person, age } : person),
        player_node: { id: '18446744073709551615', family: 'debt_due', fired: String(now - 1n), choice_tick: String(now), resolves: String(now),
          stakes: { who: preview.map(entry => entry.person), amount, unit, by: String(now + 1n) },
          options: options.map(id => ({ id, preview })), rules_default: 'ask_for_time' },
        underworld_view: null,
      };
      const ui = uiFor(world);
      const before = JSON.stringify(ui);
      const view = viewModel(ui)!;
      assert.equal(view.body!.age, age, 'Snapshot age is already whole years (Property 24 alternative)');
      assert.equal(view.body!.name, world.residents.find(person => person.id === world.player.body)!.name);
      assert.equal(view.body!.origin, world.residents.find(person => person.id === world.player.body)!.origin);
      assert.deepEqual(view.choice!.stakes, { who: preview.map(entry => namesById(world).get(entry.person)), amount, unit, by: String(now + 1n), days: '1' });
      assert.equal(view.choice!.fired, String(now - 1n));
      assert.equal(view.choice!.choiceTick, String(now));
      assert.equal(view.choice!.resolves, String(now));
      for (const option of view.choice!.options) {
        assert.deepEqual(option.preview, preview.map(entry => ({ person: namesById(world).get(entry.person), personId: entry.person,
          delta: entry.delta[0] === '-' ? entry.delta : '+' + entry.delta, what: entry.what,
          unit: entry.what.startsWith('trait:') ? 'trait_points' : entry.what === 'debt' ? 'money' : entry.what })));
      }
      const waiting: WorldSnapshot = { ...world, player_node: null,
        player: { ...world.player, place: 'waiting', body: null },
        underworld_view: { dream_price: '20', connected: [], ghost_traits: base.residents[0]!.traits, base_traits: [],
          actions: waitingSnapshot().underworld_view!.actions,
          slots: [{ slot: 'rebuilt_body', kind: 'rebuilt_body', price: '400', birth: null,
            status: { announced: true, claimable: false, affordable: false, needed: missing } }] },
      };
      const missingLines = viewModel({ ...ui, world: waiting })!.needed[0]!.lines;
      assert.equal(missingLines.length, missing.length);
      for (const [index, item] of missing.entries()) {
        if (item.kind === 'joss_short' || item.kind === 'cap_room_short') {
          assert.ok(missingLines[index]!.includes(BigInt(item.amount).toLocaleString('en-US')), 'Needed payment amounts keep every u64 digit');
        }
      }
      assert.equal(JSON.stringify(ui), before);
    }), { numRuns: RUNS });
});

test('Identity separates ties, counts distinct Rememberers and names non-resident Persons', () => {
  const world: WorldSnapshot = { ...base, player: { ...base.player,
    earlier_bodies: [{ id: 100, name: 'Earlier One', origin: 'native', death: '42' }, { id: 101, name: 'Earlier Two', origin: 'rebuilt', death: '80' }],
    past_life_ties: [{ rememberer: 1, earlier_body: 100, affinity: -19 }, { rememberer: 1, earlier_body: 101, affinity: 21 }],
  }, person_names: [{ id: 200, name: 'Deceased Creditor' }] };
  const view = viewModel({ ...initialUiState(), world })!;
  assert.equal(view.rememberers, 1);
  assert.equal(view.bloodTies.length, base.player.blood_ties.length);
  assert.deepEqual(view.relations, world.player.relations.map(tie => ({ ...tie, name: namesById(world).get(tie.person) })));
  assert.deepEqual(view.pastLifeTies.map(tie => [tie.name, tie.earlierName, tie.affinity]), [['John Carlson', 'Earlier One', -19], ['John Carlson', 'Earlier Two', 21]]);
  assert.equal(namesById(world).get(200), 'Deceased Creditor');
  assert.equal(viewModel(initialUiState()), null);
});

test('The identity header preserves a high-u64 Soul and separates current life from a retained earlier body', () => {
  const living = structuredClone(base);
  living.player_soul = '18446744073709551615';
  const body = living.residents.find(person => person.id === living.player.body)!;
  body.name = 'Alexandria Alexandria Alexandria — the current body, not an earlier life';
  const summary = identitySummary(uiFor(living))!;
  assert.equal(summary.soul, '18446744073709551615');
  assert.equal(summary.body, body.id);
  assert.equal(summary.name, body.name);
  assert.equal(summary.status, 'living');
  assert.equal(summary.age, body.age);
  assert.equal(summary.origin, body.origin);
  const waiting = waitingSnapshot();
  waiting.player_soul = living.player_soul;
  waiting.player.earlier_bodies[0]!.name = body.name;
  const between = identitySummary(uiFor(waiting))!;
  assert.equal(between.soul, summary.soul);
  assert.equal(between.status, 'waiting');
  assert.equal(between.body, null);
  assert.equal(between.age, null);
  assert.equal(between.origin, null);
  assert.equal(between.name, waiting.player.earlier_bodies.find(earlier => earlier.id === waiting.player_wait?.ghost)!.name);
  assert.ok(!between.name.includes(summary.soul));
  assert.equal(identitySummary(initialUiState()), null);
});

test('LV-C2: view-model exposes only the coherent current node and never stale option text', () => {
  const world = pendingSnapshot('debt_due');
  const ui = uiFor(world);
  assert.equal(currentDecision(ui), world.player_node);
  assert.equal(viewModel(ui)!.choice!.worldId, 1);
  assert.deepEqual(viewModel(ui)!.choice!.options.map(option => option.id), world.player_node!.options.map(option => option.id));
  for (const playerNode of [{ pending: false }, { pending: true, node: '11', answered: false },
    { pending: true, node: '12', answered: true }] as const) {
    const stale = { ...ui, playerNode };
    assert.equal(currentDecision(stale), null); assert.equal(viewModel(stale)!.choice, null);
  }
  const sending = reduce(ui, { type: 'request-sent', request: { type: 'choose', id: 1, node: '12', option: 'repay_now' }, worldId: 1 });
  assert.equal(currentDecision(sending), null); assert.equal(viewModel(sending)!.choice, null);
  const historical = { ...ui, scene: { worldId: 1, tick: ui.tick!, reasons: ['player_died'] as const,
    world, entries: sceneQueue(['player_died'], world, 1, [{ event: '40', tick: world.tick, kind: 'death', body: 100, name: 'Earlier Body', origin: 'native' }]) } };
  assert.equal(currentDecision(historical), world.player_node);
  assert.equal(viewModel(historical)!.choice!.id, world.player_node!.id);
});

test('LV-C2: feedbackView distinguishes real queue receipts from authoritative Bribe and Haunt facts without optimistic resource changes', () => {
  const world = waitingSnapshot();
  let ui = uiFor(world);
  const request = { type: 'haunt' as const, id: 21, target: 1 };
  ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
  ui = reduce(ui, { type: 'reply', request, worldId: 1, message: {
    type: 'reply', id: 21, ok: true, submission: { tick: '500', seqs: ['70'] },
    snapshot: { worldId: 1, runState: 'paused', tick: '500', checksum: null, tps: null, speed: 1,
      playerNode: { pending: false }, actions: [], playerLifecycle: [] },
  } });
  const queuedView = feedbackView(ui);
  assert.equal(queuedView.actions[0]!.phase, 'queued');
  assert.equal(queuedView.actions[0]!.requestId, 21);
  assert.equal(queuedView.actions[0]!.inputSeq, '70');
  assert.equal(queuedView.actions[0]!.result, null);
  assert.equal(ui.world!.joss, world.joss); assert.equal(ui.world!.underworld_view!.actions, world.underworld_view!.actions);
  ui = reduce(ui, { type: 'status', snapshot: { worldId: 1, runState: 'paused', tick: '501', checksum: null, tps: null, speed: 1,
    playerNode: { pending: false }, playerLifecycle: [], actions: [
      { worldId: 1, requestId: 21, input_seq: '70', tick: '501', kind: 'haunt', state: 'applied', target: 1,
        ghost: 2, event: '90', price: '43', intensity: '9', mood_delta: '-15' },
      { worldId: 1, requestId: null, input_seq: '71', tick: '501', kind: 'bribe', state: 'applied', amount: '100',
        ghost: 2, offering_event: '91', appeal_event: '92', ruling: null },
    ] } });
  const view = feedbackView(ui);
  assert.equal(view.actions[0]!.phase, 'applied');
  assert.deepEqual(view.actions[0]!.result, ui.actions[0]!.result);
  const haunt = view.actions[0]!.result;
  assert.ok(haunt?.kind === 'haunt' && haunt.state === 'applied');
  assert.equal(view.actions[1]!.phase, 'applied');
  assert.deepEqual(view.actions[1]!.result, ui.actions[1]!.result);
  const bribe = view.actions[1]!.result;
  assert.ok(bribe?.kind === 'bribe' && bribe.state === 'applied');
  assert.equal(bribe.ruling, null);
  assert.equal(ui.world!.joss, world.joss); assert.equal(ui.world!.underworld_view!.actions, world.underworld_view!.actions);
});

test('LV-C2: feedbackView preserves authoritative same-world actions and lifecycle before a World Snapshot arrives', () => {
  const create = { type: 'create-world' as const, id: 1, seed: '1', config: '{}' };
  const snapshot = { worldId: 1, runState: 'paused' as const, tick: '0', checksum: null, tps: null, speed: 1,
    playerNode: { pending: false as const }, actions: [], playerLifecycle: [] };
  let ui = reduce(initialUiState(), { type: 'request-sent', request: create, worldId: 0 });
  ui = reduce(ui, { type: 'reply', request: create, worldId: 0,
    message: { type: 'reply', id: 1, ok: true, snapshot } });
  const request = { type: 'haunt' as const, id: 2, target: 31 };
  ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
  ui = reduce(ui, { type: 'reply', request, worldId: 1,
    message: { type: 'reply', id: 2, ok: true, snapshot, submission: { tick: '0', seqs: ['70'] } } });
  assert.equal(ui.world, null);
  assert.equal(feedbackView(ui).actions[0]!.phase, 'queued');
  const fact = { event: '92', tick: '1', kind: 'possession' as const, body: 31, name: 'Recorded Body', origin: 'possessed' as const };
  ui = reduce(ui, { type: 'status', snapshot: { ...snapshot, tick: '1', playerLifecycle: [fact], actions: [
    { worldId: 1, requestId: 2, input_seq: '70', tick: '1', kind: 'haunt', state: 'applied', target: 31,
      ghost: 2, event: '91', price: '43', intensity: '9', mood_delta: '-15' },
  ] } });
  const view = feedbackView(ui);
  assert.equal(ui.world, null);
  assert.equal(viewModel(ui), null);
  assert.equal(view.actions[0]!.phase, 'applied');
  assert.equal(view.actions[0]!.requestId, 2);
  assert.equal(view.actions[0]!.inputSeq, '70');
  assert.deepEqual(view.actions[0]!.result, ui.actions[0]!.result);
  assert.equal(view.actions[0]!.submission?.tick, '0');
  assert.deepEqual(view.playerLifecycle, [fact]);
  assert.equal(view.playerLifecycle, ui.playerLifecycle);
  assert.equal(view.settledOmitted, 0);
});

test('LV-C2: World projection excludes feedback while feedbackView retains unresolved rows and the latest twenty settled results', () => {
  let ui = uiFor(waitingSnapshot());
  const unknown = { type: 'haunt' as const, id: 1, target: 31 };
  ui = reduce(ui, { type: 'request-sent', request: unknown, worldId: 1 });
  ui = reduce(ui, { type: 'request-failed', request: unknown, worldId: 1, error: 'controlled transport failure' });
  const queued = { type: 'claim' as const, id: 2, slot: 'imported_vessel' as const, carryOver: null };
  ui = reduce(ui, { type: 'request-sent', request: queued, worldId: 1 });
  const snapshot = { worldId: 1, runState: 'paused' as const, tick: '500', checksum: null, tps: null, speed: 1,
    playerNode: { pending: false as const }, actions: [], playerLifecycle: [] };
  ui = reduce(ui, { type: 'reply', request: queued, worldId: 1,
    message: { type: 'reply', id: 2, ok: true, snapshot, submission: { tick: '500', seqs: ['70'] } } });
  const sending = { type: 'haunt' as const, id: 3, target: 31 };
  ui = reduce(ui, { type: 'request-sent', request: sending, worldId: 1 });
  ui = reduce(ui, { type: 'status', snapshot: { ...snapshot, tick: '501', actions: Array.from({ length: 21 }, (_, index) => ({
    worldId: 1, requestId: null, input_seq: String(100 + index), tick: '501', kind: 'bribe' as const,
    state: 'rejected' as const, reason: 'bad_amount' as const, amount: '0',
  })) } });
  const before = ui.actions;
  const worldView = viewModel(ui)!;
  assert.equal(Object.hasOwn(worldView, 'actions'), false);
  assert.equal(Object.hasOwn(worldView, 'settledOmitted'), false);
  assert.equal(Object.hasOwn(worldView, 'playerLifecycle'), false);
  const view = feedbackView(ui);
  assert.equal(view.actions.length, 23);
  assert.deepEqual(view.actions.slice(0, 3).map(action => action.phase), ['unknown', 'queued', 'sending']);
  assert.deepEqual(view.actions.slice(0, 3).map(action => action.requestId), [1, 2, 3]);
  assert.equal(view.actions[1]!.submission?.tick, '500');
  assert.equal(view.actions[1]!.inputSeq, '70');
  assert.equal(view.actions[3]!.phase, 'rejected');
  assert.equal(view.actions[3]!.result?.state === 'rejected' ? view.actions[3]!.result.reason : undefined, 'bad_amount');
  assert.equal(view.actions[3]!.inputSeq, '101');
  assert.equal(view.actions[22]!.inputSeq, '120');
  assert.equal(view.settledOmitted, 1);
  assert.equal(ui.actions, before);
  assert.notEqual(view.actions, ui.actions);
});
