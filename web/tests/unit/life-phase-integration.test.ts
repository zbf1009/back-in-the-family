import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { choiceResult } from '../../src/main/choice-result.ts';
import { currentLifePhase, entryContext, exportNotebook } from '../../src/main/life-journal.ts';
import { memorialKeyScene } from '../../src/main/memorial.ts';
import { operationStates } from '../../src/main/operation-state.ts';
import { currentDecision, initialUiState, reduce, type UiState } from '../../src/main/ui-state.ts';
import type { SceneClose } from '../../src/main/scene-queue.ts';
import type { StoryActor, StoryBatch, StoryEvent } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { snapshot } from './helpers/view.ts';
import { actorContext, admitChoice, batch, carrierSnapshot, choiceChronicle, choiceNode, createCarrierState,
  deliver, estate, kinDeath, memorialFacts, offerChoice, playerDeath, playerRebirth } from '../fixtures/lifecycle-carriers.ts';

// Public reducer -> presentation projections, using constructed supported native
// carriers. This is not a live gameplay, input-stream or replay verification.
function memorialClose(ui: UiState): SceneClose {
  assert.ok(ui.memorial, 'a newly delivered current-life spouse Death must open a card');
  return { worldId: ui.worldId, tick: ui.memorial.entry.world.tick, entry: ui.memorial.entry };
}

for (const appended of [[], ['902']]) {
  test(`an exact-node Chronicle replaces admission and hides only its choice slip (${appended.length ? 'linked event' : 'empty appended'})`, () => {
    let ui = admitChoice(offerChoice(createCarrierState(snapshot)));
    assert.equal(currentDecision(ui), null, 'the admitted choice is no longer offered');
    assert.equal(choiceResult(ui)?.kind, 'filed');
    assert.equal(choiceResult(ui)?.node, '120');
    assert.deepEqual(operationStates(ui).map(state => [state.kind, state.phase]), [['choose', 'received']]);
    const filed = choiceResult(ui)!.text;
    const unrelated = choiceChronicle('999', '0', { applied: 'repay_now' });
    ui = deliver(ui, batch({ chronicle: [unrelated] }));
    assert.equal(choiceResult(ui)?.kind, 'filed', 'same family/day/people is not an exact node join');
    assert.equal(choiceResult(ui)?.text, filed);
    const linked: StoryEvent[] = appended.length ? [kinDeath('902', { kind: { type: 'social', kind: 'insult', doer: 2, target: 1, intensity: 1 }, relevance: 'self' })] : [];
    const record = choiceChronicle('120', '1', { appended });
    ui = deliver(ui, batch({ events: linked, chronicle: [record] }));
    assert.equal(choiceResult(ui)?.kind, 'result');
    assert.equal(choiceResult(ui)?.node, '120');
    assert.ok(choiceResult(ui)!.text.trim());
    assert.notEqual(choiceResult(ui)!.text, filed);
    assert.deepEqual(operationStates(ui), [], 'the obsolete received slip must not duplicate the visible result');
    assert.equal(ui.actions[0]!.phase, 'queued', 'a Chronicle is not a transport processing result');
    assert.equal(ui.actions[0]!.result, null);
    assert.deepEqual(ui.actions[0]!.submission, { tick: '500', seqs: ['10'] });
    assert.deepEqual(exportNotebook(ui.notebook).chronicle, { '0': unrelated, '1': record });
  });
}

test('a second offered node and its admission supersede the first result without consuming either input receipt', () => {
  let ui = admitChoice(offerChoice(createCarrierState(snapshot)));
  const first = choiceChronicle();
  ui = deliver(ui, batch({ chronicle: [first] }));
  assert.equal(choiceResult(ui)?.node, '120');
  ui = offerChoice(ui, choiceNode('121'));
  assert.equal(currentDecision(ui)?.id, '121');
  assert.equal(choiceResult(ui), null, 'a previous result cannot cover the next real decision');
  ui = admitChoice(ui, 11);
  assert.equal(choiceResult(ui)?.node, '121');
  assert.equal(choiceResult(ui)?.kind, 'filed');
  ui = deliver(ui, batch({ chronicle: [choiceChronicle('120', '2', { source: 'rules_default' })] }));
  assert.equal(choiceResult(ui)?.node, '121');
  assert.equal(choiceResult(ui)?.kind, 'filed', 'late older-node results cannot displace the latest admission');
  ui = deliver(ui, batch({ chronicle: [choiceChronicle('121', '3')] }));
  assert.equal(choiceResult(ui)?.kind, 'result');
  assert.equal(choiceResult(ui)?.node, '121');
  assert.deepEqual(ui.actions.map(action => [action.requestId, action.phase, action.inputSeq]), [[10, 'queued', '10'], [11, 'queued', '11']]);
});

test('death and rebirth expire old-life slips but retain raw facts and unresolved transport', () => {
  let ui = admitChoice(offerChoice(createCarrierState(snapshot)));
  const oldRecord = choiceChronicle();
  ui = deliver(ui, batch({ chronicle: [oldRecord] }));
  const oldAction = ui.actions[0]!;
  const aliveKey = currentLifePhase(ui.notebook, ui.world)!.key;
  ui = playerDeath(ui);
  assert.equal(currentLifePhase(ui.notebook, ui.world)?.kind, 'waiting');
  assert.notEqual(currentLifePhase(ui.notebook, ui.world)?.key, aliveKey);
  assert.equal(choiceResult(ui), null);
  assert.deepEqual(operationStates(ui), []);
  assert.deepEqual(ui.actions[0], oldAction);
  assert.deepEqual(exportNotebook(ui.notebook).chronicle['0'], oldRecord);
  assert.equal(entryContext(ui.notebook, 'c:0')?.phase.key, aliveKey);
  ui = playerRebirth(ui);
  assert.equal(currentLifePhase(ui.notebook, ui.world)?.kind, 'life');
  assert.equal(currentLifePhase(ui.notebook, ui.world)?.person, 4);
  assert.equal(choiceResult(ui), null);
  assert.deepEqual(operationStates(ui), []);
  assert.deepEqual(ui.actions[0], oldAction);
  assert.ok(ui.notebook.events.get('910') && ui.notebook.events.get('912'));
  ui = admitChoice(offerChoice(ui, choiceNode('122', 4)), 12);
  const recent = choiceChronicle('122', '1', { tick: '502', stakes: choiceNode('122', 4).stakes, actorContext: actorContext(4) });
  ui = deliver(ui, batch({ chronicle: [recent] }));
  assert.equal(choiceResult(ui)?.node, '122');
  const late = choiceChronicle('120', '2');
  ui = deliver(ui, batch({ chronicle: [late] }), undefined, { tick: '500' });
  assert.equal(ui.tick, '502');
  assert.equal(choiceResult(ui)?.node, '122');
  assert.equal(choiceResult(ui)?.kind, 'result');
  assert.equal(entryContext(ui.notebook, 'c:2')?.phase.key, aliveKey);
  assert.equal(ui.actions[0]!.phase, 'queued');
});

test('waiting-phase queued paperwork expires on rebirth without receiving a fabricated application result', () => {
  let ui = playerDeath(createCarrierState(snapshot));
  const request = { type: 'haunt', id: 20, target: 1 } as const;
  ui = reduce(ui, { type: 'request-sent', request });
  ui = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: 20, ok: true,
    snapshot: carrierSnapshot(ui), submission: { tick: '501', seqs: ['20'] } } });
  assert.deepEqual(operationStates(ui).map(state => [state.kind, state.phase]), [['haunt', 'received']]);
  const action = ui.actions.at(-1)!;
  ui = playerRebirth(ui);
  assert.deepEqual(operationStates(ui), []);
  assert.deepEqual(ui.actions.at(-1), action);
  assert.equal(ui.actions.at(-1)!.result, null);
});

test('an old-world result cannot displace the replacement world choice', () => {
  const old = admitChoice(offerChoice(createCarrierState(snapshot)));
  let ui = admitChoice(offerChoice(createCarrierState(snapshot, 2), choiceNode('220')), 30);
  const before = choiceResult(ui);
  ui = reduce(ui, { type: 'status', snapshot: carrierSnapshot(old, { story: [{ worldId: 1,
    batch: batch({ chronicle: [choiceChronicle()] }) }] }) });
  assert.equal(ui.worldId, 2);
  assert.deepEqual(choiceResult(ui), before);
  assert.equal(ui.notebook.chronicle.size, 0);
  assert.equal(ui.actions.length, 1);
});

for (const sameBatch of [true, false]) {
  test(`current-life kin Death joins only its exact Estate and preserves card identity (${sameBatch ? 'same delivery' : 'late delivery'})`, () => {
    let ui = createCarrierState(snapshot);
    const death = kinDeath(); const inheritance = estate();
    ui = deliver(ui, memorialFacts(ui, sameBatch ? [death, inheritance] : [death]));
    const close = memorialClose(ui);
    assert.equal(ui.memorial!.capture.name, 'John Carlson');
    assert.equal(ui.memorial!.capture.nativeAge, '38');
    assert.equal(ui.memorial!.capture.kinRole, 'spouse');
    assert.equal(ui.memorial!.capture.playerBody, 2);
    assert.equal(ui.memorial!.capture.eventId, '900');
    if (!sameBatch) {
      ui = reduce(ui, { type: 'scene-settled', expected: close });
      ui = deliver(ui, batch({ events: [inheritance] }));
      assert.strictEqual(ui.memorial!.entry, close.entry, 'Estate enrichment must not replay the scene');
      assert.strictEqual(ui.settledMemorial?.entry, close.entry);
    }
    assert.deepEqual(ui.memorial!.capture.estate, { eventId: '901', amount: '73007' });
    assert.ok(memorialKeyScene(ui.memorial!.capture).lines.some(line => line.includes('73,007')));
    assert.deepEqual(exportNotebook(ui.notebook).events, { '900': death, '901': inheritance });
    assert.equal(ui.tick, '500');
    assert.equal(ui.actions.length, 0);
  });
}

for (const [label, wrong] of [
  ['heir', estate('903', { kind: { type: 'inheritance', deceased: 1, heir: 3, amount: '1' } })],
  ['deceased', estate('903', { kind: { type: 'inheritance', deceased: 3, heir: 2, amount: '1' } })],
  ['day', estate('903', { tick: '499' })],
  ['cause', estate('903', { causedBy: ['899'] })],
] as const) {
  test(`an Estate with the wrong ${label} remains a raw fact but cannot enrich the memorial`, () => {
    let ui = createCarrierState(snapshot);
    ui = deliver(ui, memorialFacts(ui));
    const entry = memorialClose(ui).entry;
    ui = deliver(ui, batch({ events: [wrong] }));
    assert.strictEqual(ui.memorial?.entry, entry);
    assert.equal(ui.memorial?.capture.estate, undefined);
    assert.deepEqual(exportNotebook(ui.notebook).events['903'], wrong);
    ui = deliver(ui, batch({ events: [estate()] }));
    assert.equal(ui.memorial?.capture.estate?.eventId, '901', 'a rejected join must not consume the real later Estate');
  });
}

test('an Estate from another world cannot enrich the current card', () => {
  let ui = createCarrierState(snapshot); ui = deliver(ui, memorialFacts(ui));
  const capture = ui.memorial!.capture;
  ui = reduce(ui, { type: 'status', snapshot: carrierSnapshot(ui, { worldId: 2,
    story: [{ worldId: 2, batch: batch({ events: [estate()] }) }] }) });
  assert.strictEqual(ui.memorial?.capture, capture);
  assert.equal(ui.notebook.events.get('901'), undefined);
});

for (const [label, facts] of [
  ['opening', batch({ opening: true, events: [kinDeath('900', { relevanceBasis: 'opening-current' })] })],
  ['extended kin', batch({ events: [kinDeath('900', { actorContext: [{ relativeTo: 2, basis: 'observed-day-start', actors: [{ person: 1, kinRole: 'cousin' }] }] })] })],
  ['affinity only', batch({ events: [kinDeath('900', { actorContext: [{ relativeTo: 2, basis: 'observed-day-start', actors: [{ person: 1 }] }] })] })],
] as const) {
  test(`${label} Death records do not create an automatic memorial`, () => {
    const ui = deliver(createCarrierState(snapshot), facts);
    assert.equal(ui.memorial, null);
    assert.ok(ui.notebook.events.get('900'), 'presentation qualification must never discard the fact');
  });
}

test('a Death already offered as a family decision uses the real node rather than a duplicate memorial', () => {
  let ui = createCarrierState(snapshot);
  const node = { ...choiceNode('125'), family: 'family_death' as const, fired: '500', stakes: { ...choiceNode().stakes, who: [1, 2] },
    options: [{ id: 'comfort_mourner' as const, preview: [] }, { id: 'stay_away' as const, preview: [] }], rules_default: 'comfort_mourner' as const };
  const world = { ...ui.world!, player_node: node };
  ui = deliver(ui, memorialFacts(ui), world, { playerNode: { pending: true, node: node.id, answered: false }, stop: { reasons: ['player_node'], world } });
  assert.equal(ui.memorial, null);
  assert.equal(currentDecision(ui)?.id, '125');
  assert.equal(ui.scene?.entries.filter(entry => entry.node === '125').length, 1);
  assert.ok(ui.notebook.events.get('900'));
});

test('settlement, Play, ordinary status and user Stop retain a card without advancing its clock or inputs', () => {
  let ui = createCarrierState(snapshot); ui = deliver(ui, memorialFacts(ui));
  const close = memorialClose(ui); const world = ui.world; const actions = ui.actions;
  ui = reduce(ui, { type: 'scene-settled', expected: close });
  assert.strictEqual(ui.memorial!.entry, close.entry);
  assert.strictEqual(ui.settledMemorial?.entry, close.entry);
  const request = { type: 'run', id: 40 } as const;
  ui = reduce(ui, { type: 'request-sent', request });
  ui = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: 40, ok: true, snapshot: carrierSnapshot(ui, { runState: 'running' }) } });
  assert.strictEqual(ui.memorial!.entry, close.entry);
  ui = reduce(ui, { type: 'status', snapshot: carrierSnapshot(ui, { tps: 1 }) });
  ui = deliver(ui, batch(), ui.world!, { runState: 'paused' });
  assert.strictEqual(ui.memorial!.entry, close.entry);
  assert.strictEqual(ui.world, world);
  assert.strictEqual(ui.actions, actions);
  assert.equal(ui.tick, '500');
  assert.equal(ui.checksum, '1111111111111111');
  ui = reduce(ui, { type: 'scene-close', expected: close });
  assert.equal(ui.memorial, null);
  assert.equal(ui.tick, '500');
  assert.deepEqual(ui.actions, []);
});

test('Close is guarded by exact active entry, current world and the actual latest node even when it is hidden by answering or sending', () => {
  let ui = createCarrierState(snapshot); ui = deliver(ui, memorialFacts(ui));
  const close = memorialClose(ui);
  assert.strictEqual(reduce(ui, { type: 'scene-close', expected: { ...close, worldId: 2 } }).memorial, ui.memorial);
  assert.strictEqual(reduce(ui, { type: 'scene-close', expected: { ...close, entry: { ...close.entry } } }).memorial, ui.memorial);
  const node = choiceNode('126'); const world = { ...ui.world!, player_node: node };
  ui = deliver(ui, batch(), world, { playerNode: { pending: true, node: node.id, answered: true } });
  assert.equal(currentDecision(ui), null);
  assert.ok(ui.memorial, 'the retained accepted native node is not a new unresolved scene');
  assert.ok(reduce(ui, { type: 'scene-close', expected: close }).memorial, 'hidden decision UI is not permission to dismiss');
  ui = reduce(ui, { type: 'request-sent', request: { type: 'choose', id: 41, node: node.id, option: 'ignore_it' } });
  assert.equal(currentDecision(ui), null);
  assert.ok(reduce(ui, { type: 'scene-close', expected: close }).memorial, 'sending does not make the actual node disappear');
  ui = reduce(ui, { type: 'status', snapshot: carrierSnapshot(ui, { decision: {
    config: 'ready', enabled: true, sessionCap: 40, spent: 1, waitSeconds: 10,
    pending: { requestId: 42, worldId: 1, tick: '500', trigger: '900' }, outcome: null,
  } }) });
  assert.equal(currentDecision(ui), null);
  assert.ok(reduce(ui, { type: 'scene-close', expected: close }).memorial, 'a held decision also leaves the actual node guard intact');
  ui = offerChoice(ui, choiceNode('128'));
  assert.equal(ui.memorial, null, 'an actual unresolved node supersedes the memorial');
  assert.equal(currentDecision(ui), null, 'the held decision UI may hide that unresolved node');
  const pendingScene = ui.scene;
  ui = reduce(ui, { type: 'scene-close', expected: close });
  assert.strictEqual(ui.scene, pendingScene, 'a stale Close cannot dismiss the held unresolved node scene');
  assert.equal(ui.world?.player_node?.id, '128');
});

test('Close, replacement scene and lifecycle boundaries do not let Death redelivery or late Estate reopen a card', () => {
  for (const removal of ['close', 'node', 'death', 'rebirth', 'world'] as const) {
    let ui = createCarrierState(snapshot); const facts = memorialFacts(ui);
    ui = deliver(ui, facts); const close = memorialClose(ui);
    if (removal === 'close') ui = reduce(ui, { type: 'scene-close', expected: close });
    else if (removal === 'node') ui = offerChoice(ui, choiceNode('127'));
    else if (removal === 'death') ui = playerDeath(ui);
    else if (removal === 'rebirth') ui = playerRebirth(playerDeath(ui));
    else {
      const replacement = createCarrierState(snapshot, 2);
      ui = reduce(ui, { type: 'reply', request: { type: 'create-world', id: 50, seed: '1', config: '{}' },
        message: { type: 'reply', id: 50, ok: true, snapshot: carrierSnapshot(replacement), world: replacement.world! } });
    }
    assert.equal(ui.memorial, null, removal);
    const stale = carrierSnapshot(ui, { worldId: 1, story: [{ worldId: 1, batch: batch({ ...facts, events: [kinDeath(), estate()] }) }] });
    ui = reduce(ui, { type: 'status', snapshot: stale });
    assert.equal(ui.memorial, null, `${removal}: old Death/Estate cannot reopen`);
    ui = reduce(ui, { type: 'scene-close', expected: close });
    assert.equal(ui.memorial, null);
    if (removal !== 'world') assert.ok(ui.notebook.events.get('900') && ui.notebook.events.get('901'));
  }
});

for (const pendingDream of [false, true]) {
  test(`an ordinary kin memorial replaces only the settled visible rebirth, preserving pending facts=${pendingDream}`, () => {
    let ui = playerDeath(createCarrierState(snapshot));
    assert.ok(ui.scene);
    ui = reduce(ui, { type: 'scene-settled', expected: { worldId: ui.worldId, tick: ui.scene.tick, entry: ui.scene.entries[0]! } });
    ui = playerRebirth(ui);
    assert.equal(ui.scene?.entries[0]?.keyScene?.lifecycle?.kind, 'possession');
    const rebirth: SceneClose = { worldId: ui.worldId, tick: ui.scene!.tick, entry: ui.scene!.entries[0]! };
    const request = { type: 'run', id: 45 } as const;
    ui = reduce(ui, { type: 'request-sent', request });
    ui = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: request.id, ok: true,
      snapshot: carrierSnapshot(ui, { runState: 'running' }) } });
    ui = reduce(ui, { type: 'scene-settled', expected: rebirth });
    assert.strictEqual(ui.scene?.entries[0], rebirth.entry, 'Play and settlement leave the unclosed scene visible');
    if (pendingDream) ui = deliver(ui, batch({ dreams: [{ eventId: '913', inputSeq: '46', tick: '502',
      ghost: 2, dreamer: 4, intent: 'warn', price: '20' }] }));
    const pending = ui.scene!.entries.slice(1);
    const seen = ui.sceneEpisode!.seen;
    const world = ui.world; const actions = ui.actions;
    const facts = memorialFacts(ui, [kinDeath('920', { tick: '503', actorContext: actorContext(4) })]);
    const ordinary = carrierSnapshot(ui, { tick: '503', story: [{ worldId: ui.worldId, batch: facts }] });
    assert.equal(ordinary.stop, undefined, 'an ordinary Death must not require a simulation stop');
    ui = reduce(ui, { type: 'status', snapshot: ordinary });
    const close = memorialClose(ui);
    assert.equal(ui.runState, 'running');
    assert.equal(ui.memorial!.capture.playerBody, 4);
    assert.equal(ui.settledScene, null);
    assert.deepEqual(ui.scene?.entries ?? [], pending);
    if (pendingDream) {
      assert.ok(ui.sceneEpisode!.seen.includes(rebirth.entry.identity), 'the retired identity remains seen while undisplayed facts remain');
      assert.deepEqual(ui.sceneEpisode!.seen, seen);
    }
    assert.strictEqual(reduce(ui, { type: 'scene-close', expected: rebirth }), ui);
    assert.strictEqual(reduce(ui, { type: 'scene-settled', expected: rebirth }), ui);
    for (const wrong of [{ ...close, worldId: 2 }, { ...close, tick: '503' }, { ...close, entry: { ...close.entry } }]) {
      assert.strictEqual(reduce(ui, { type: 'scene-close', expected: wrong }), ui);
    }
    ui = reduce(ui, { type: 'scene-close', expected: close });
    assert.equal(ui.memorial, null);
    assert.deepEqual(ui.scene?.entries ?? [], pending);
    assert.strictEqual(reduce(ui, { type: 'scene-close', expected: rebirth }), ui);
    assert.strictEqual(reduce(ui, { type: 'scene-close', expected: close }), ui);
    assert.strictEqual(ui.world, world); assert.strictEqual(ui.actions, actions);
    assert.equal(ui.tick, '503');
    assert.ok(ui.notebook.events.get('912') && ui.notebook.events.get('920'));
    if (pendingDream) {
      assert.ok(ui.notebook.dreams.get('913'));
      assert.equal(ui.scene?.entries[0]?.keyScene?.source.kind, 'event');
      const next = { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: pending[0]! };
      ui = reduce(ui, { type: 'scene-close', expected: next });
      assert.equal(ui.scene, null, 'the preserved pending fact still has a legal exact Close');
    }
    ui = reduce(ui, { type: 'status', snapshot: ordinary });
    assert.equal(ui.memorial, null, 'the admitted Death does not reopen');
    assert.equal(ui.scene, null, 'redelivery cannot resurrect the retired rebirth or closed Dream');
  });
}

for (const settlement of ['none', 'wrong-world', 'wrong-tick', 'copied-entry'] as const) {
  test(`a memorial preserves a rebirth without an exact settled head: ${settlement}`, () => {
    let ui = playerRebirth(playerDeath(createCarrierState(snapshot)));
    const first = { worldId: ui.worldId, tick: ui.scene!.tick, entry: ui.scene!.entries[0]! };
    ui = reduce(ui, { type: 'scene-close', expected: first });
    assert.equal(ui.scene?.entries[0]?.keyScene?.lifecycle?.kind, 'possession');
    const scene = ui.scene!;
    const expected = { worldId: ui.worldId, tick: scene.tick, entry: scene.entries[0]! };
    if (settlement !== 'none') ui = { ...ui, settledScene: settlement === 'wrong-world' ? { ...expected, worldId: 2 }
      : settlement === 'wrong-tick' ? { ...expected, tick: (BigInt(scene.tick) + 1n).toString() } : { ...expected, entry: { ...expected.entry } } };
    ui = deliver(ui, memorialFacts(ui, [kinDeath('920', { tick: '503', actorContext: actorContext(4) })]), undefined, { tick: '503' });
    const close = memorialClose(ui);
    assert.strictEqual(ui.scene, scene, 'an unsettled or scheduled next scene is not the replaced settled head');
    ui = reduce(ui, { type: 'scene-close', expected: close });
    assert.strictEqual(ui.scene, scene);
  });
}

test('replacing a memorial does not retire a settled scene hidden behind the existing card', () => {
  let ui = playerRebirth(playerDeath(createCarrierState(snapshot)));
  ui = reduce(ui, { type: 'scene-close', expected: { worldId: ui.worldId, tick: ui.scene!.tick, entry: ui.scene!.entries[0]! } });
  const hidden = { worldId: ui.worldId, tick: ui.scene!.tick, entry: ui.scene!.entries[0]! };
  ui = deliver(ui, memorialFacts(ui, [kinDeath('920', { tick: '503', actorContext: actorContext(4) })]), undefined, { tick: '503' });
  const firstCard = memorialClose(ui);
  ui = reduce(ui, { type: 'scene-settled', expected: hidden });
  assert.strictEqual(ui.settledScene?.entry, hidden.entry);
  ui = deliver(ui, memorialFacts(ui, [kinDeath('921', { tick: '504', actorContext: actorContext(4) })]), undefined, { tick: '504' });
  assert.equal(ui.memorial?.capture.eventId, '921');
  assert.strictEqual(ui.scene?.entries[0], hidden.entry);
  assert.strictEqual(reduce(ui, { type: 'scene-close', expected: firstCard }), ui);
  ui = reduce(ui, { type: 'scene-close', expected: memorialClose(ui) });
  assert.strictEqual(ui.scene?.entries[0], hidden.entry);
});

test('a newly delivered old-life or waiting-phase kin Death cannot open a memorial in the reborn life', () => {
  let ui = playerRebirth(playerDeath(createCarrierState(snapshot)));
  const event = kinDeath('930');
  ui = deliver(ui, batch({ events: [event] }), undefined, { tick: '500' });
  assert.equal(ui.memorial, null);
  assert.ok(ui.notebook.events.get('930'));
  assert.equal(entryContext(ui.notebook, 'e:930')?.phase.person, 2);
  assert.equal(currentLifePhase(ui.notebook, ui.world)?.person, 4);
  let waiting = playerDeath(createCarrierState(snapshot));
  waiting = deliver(waiting, batch({ events: [kinDeath('931', { tick: '501' })] }));
  assert.equal(waiting.memorial, null);
  assert.ok(waiting.notebook.events.get('931'));
});

test('Native seed-1205 opening, spouse Death and own Death preserve their admitted journal and memorial identities', () => {
  const openingWorld: WorldSnapshot = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205-opening.world.json', import.meta.url), 'utf8'));
  // Exact native prefix at tick 4585, captured from default-play-death.replay.json.
  const memorialWorld: WorldSnapshot = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205-memorial.world.json', import.meta.url), 'utf8'));
  const memorialBatch: StoryBatch = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205-memorial.batch.json', import.meta.url), 'utf8'));
  const selected: { openingBatch: StoryBatch } = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
  const deathProof: { world: WorldSnapshot; facts: { actors: StoryActor[]; death: StoryEvent } } = JSON.parse(readFileSync(new URL('../fixtures/art-sample-seed1205.json', import.meta.url), 'utf8'));
  const player = openingWorld.residents.find(person => person.id === openingWorld.player.body)!;
  assert.equal(player.age, 45);
  assert.equal(player.sex, 'female');
  let ui = reduce(initialUiState(), { type: 'reply', request: { type: 'create-world', id: 1, seed: '1205', config: '{}' },
    message: { type: 'reply', id: 1, ok: true, world: openingWorld,
      snapshot: { ...carrierSnapshot(initialUiState()), worldId: 7, runState: 'paused', tick: openingWorld.tick,
        story: [{ worldId: 7, batch: selected.openingBatch }] } } });
  const openingIdentity = ui.notebook.identities.at(0)!;
  const opening = entryContext(ui.notebook, openingIdentity)!;
  assert.equal(opening.phase.person, player.id);
  assert.equal(opening.phase.name, player.name);
  assert.equal(opening.actors.get(player.id)!.ageAtDeath, undefined);
  ui = deliver(ui, memorialBatch, memorialWorld);
  const death = memorialBatch.events.find(event => event.id === '1998')!;
  const estate = memorialBatch.events.find(event => event.id === '1999')!;
  assert.equal(death.kind.type, 'death');
  assert.equal(estate.kind.type, 'inheritance');
  assert.ok(ui.memorial);
  const captured = entryContext(ui.notebook, `e:${death.id}`)!;
  assert.equal(captured.phase.key, opening.phase.key);
  assert.equal(ui.memorial.capture.eventId, death.id);
  assert.equal(ui.memorial.capture.playerBody, player.id);
  assert.equal(ui.memorial.capture.nativeAge, captured.actors.get(ui.memorial.capture.deceased)!.ageAtDeath);
  assert.equal(ui.memorial.capture.sex, captured.actors.get(ui.memorial.capture.deceased)!.sex);
  assert.equal(ui.memorial.capture.estate?.eventId, estate.id);
  if (estate.kind.type === 'inheritance') assert.equal(ui.memorial.capture.estate?.amount, estate.kind.amount);
  const card = ui.memorial;
  ui = deliver(ui, batch({ actors: deathProof.facts.actors, events: [deathProof.facts.death] }), deathProof.world);
  assert.equal(ui.memorial, null);
  assert.equal(currentLifePhase(ui.notebook, ui.world)!.kind, 'waiting');
  assert.equal(entryContext(ui.notebook, openingIdentity), opening);
  assert.equal(entryContext(ui.notebook, `e:${death.id}`), captured);
  assert.equal(card.capture.phaseKey, opening.phase.key);
  const ownDeath = entryContext(ui.notebook, `e:${deathProof.facts.death.id}`)!;
  assert.equal(ownDeath.phase.key, opening.phase.key);
  assert.equal(ownDeath.actors.get(player.id)!.ageAtDeath, deathProof.facts.actors.find(actor => actor.person === player.id)!.ageAtDeath);
  assert.equal(opening.actors.get(player.id)!.ageAtDeath, undefined);
  assert.equal(exportNotebook(ui.notebook).events[death.id], death);
  assert.equal(exportNotebook(ui.notebook).events[estate.id], estate);
  assert.equal(ui.actions.length, 0);
});
