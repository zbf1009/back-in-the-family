<script lang="ts">
  import { onMount } from 'svelte';
  import LifeSurface from '../../src/ui/LifeSurface.svelte';
  import { loadLifeSprites, type SpriteSet } from '../../src/art/sprites.ts';
  import { currentLifePhase, exportNotebook } from '../../src/main/life-journal.ts';
  import { choiceResult } from '../../src/main/choice-result.ts';
  import { operationStates } from '../../src/main/operation-state.ts';
  import { memorialKeyScene } from '../../src/main/memorial.ts';
  import { reduce, type UiEvent } from '../../src/main/ui-state.ts';
  import { feedbackView } from '../../src/main/view-model.ts';
  import { claimRequest, dreamRequest, type UnderworldForm } from '../../src/main/customization.ts';
  import type { SceneClose } from '../../src/main/scene-queue.ts';
  import type { Request } from '../../src/shared/protocol.ts';
  import type { PlayerOption, Slot, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
  import { actorContext, batch, carrierSnapshot, carrierSource, choiceChronicle, choiceNode, createCarrierState,
    deliver, estate, kinDeath, memorialFacts, offerChoice, playerDeath, playerRebirth } from './lifecycle-carriers.ts';

  const { baseline }: { baseline: WorldSnapshot } = $props();
  const scenario = new URLSearchParams(location.search).get('state') ?? 'memorial';
  if (!['memorial', 'choice', 'living', 'waiting', 'reborn'].includes(scenario)) throw Error(`Unknown lifecycle carrier: ${scenario}`);
  let initial = createCarrierState(baseline);
  if (scenario === 'living' || scenario === 'choice') initial = deliver(initial, batch({ events: [kinDeath('890', {
    kind: { type: 'social', kind: 'help', doer: 2, target: 1, intensity: 1 }, relevance: 'self' })] }));
  if (scenario === 'memorial') initial = deliver(initial, memorialFacts(initial));
  if (scenario === 'choice') initial = offerChoice(initial);
  if (scenario === 'waiting' || scenario === 'reborn') initial = playerDeath(initial);
  if (scenario === 'reborn') initial = playerRebirth(initial);
  let ui = $state.raw(initial);
  let sprites: SpriteSet | null = $state.raw(null);
  let assetError = $state<string | null>(null);
  let presentationVersion = $state(0);
  let requestId = 100;
  let chronicleIndex = 0;
  let prePlayClose = $state.raw<SceneClose | null>(null);
  let callbacks = $state.raw<{ kind: string; identity: string; tickBefore: string | null; tickAfter: string | null;
    actionsBefore: number; actionsAfter: number; accepted: boolean }[]>([]);
  let requests = $state.raw<Request[]>([]);
  const feedback = $derived(feedbackView(ui));

  function dispatch(event: UiEvent): void { ui = reduce(ui, event); }
  function sceneCallback(kind: 'close' | 'settled', expected: SceneClose): void {
    const previous = ui;
    dispatch({ type: kind === 'close' ? 'scene-close' : 'scene-settled', expected });
    const accepted = kind === 'close'
      ? previous.memorial?.entry === expected.entry ? ui.memorial === null
        : previous.scene?.entries[0] === expected.entry && ui.scene?.entries[0] !== expected.entry
      : ui.settledMemorial?.entry === expected.entry || ui.settledScene?.entry === expected.entry;
    callbacks = [...callbacks, { kind, identity: expected.entry.identity,
      tickBefore: previous.tick, tickAfter: ui.tick, actionsBefore: previous.actions.length, actionsAfter: ui.actions.length,
      accepted }];
  }
  async function onChoose(worldId: number, node: string, option: PlayerOption): Promise<void> {
    if (worldId !== ui.worldId) throw Error('Choice callback belongs to an obsolete fixture World');
    const request: Request = { type: 'choose', id: ++requestId, node, option };
    requests = [...requests, request];
    dispatch({ type: 'request-sent', request, worldId });
    dispatch({ type: 'reply', request, worldId, message: { type: 'reply', id: request.id, ok: true,
      submission: { tick: ui.tick!, seqs: [String(request.id)] },
      snapshot: carrierSnapshot(ui, { playerNode: { pending: true, node, answered: true } }) } });
    presentationVersion++;
  }
  async function admit(request: Request): Promise<void> {
    requests = [...requests, request];
    dispatch({ type: 'request-sent', request });
    dispatch({ type: 'reply', request, message: { type: 'reply', id: request.id, ok: true,
      submission: { tick: ui.tick!, seqs: [String(request.id)] }, snapshot: carrierSnapshot(ui) } });
    presentationVersion++;
  }
  async function onDream(): Promise<void> {
    const request = dreamRequest(ui.world!, ui.underworldForm);
    if (request === null) throw Error('Production Dream callback has no eligible carrier');
    await admit({ ...request, id: ++requestId });
  }
  async function onClaim(slot: Slot): Promise<void> {
    const request = claimRequest(ui.underworldForm, slot);
    if (request === null) throw Error('Production Claim callback has no eligible carrier');
    await admit({ ...request, id: ++requestId });
  }
  function onBribe(worldId: number, amount: string): void {
    if (worldId !== ui.worldId) throw Error('Bribe callback belongs to an obsolete fixture World');
    void admit({ type: 'bribe', id: ++requestId, amount });
  }
  function onHaunt(worldId: number, target: number): void {
    if (worldId !== ui.worldId) throw Error('Haunt callback belongs to an obsolete fixture World');
    void admit({ type: 'haunt', id: ++requestId, target });
  }
  function playback(runState: 'running' | 'paused'): void {
    if (runState === 'running' && ui.memorial === null && ui.scene !== null) {
      prePlayClose = { worldId: ui.scene.worldId, tick: ui.scene.tick, entry: ui.scene.entries[0]! };
    }
    const request: Request = { type: runState === 'running' ? 'run' : 'pause', id: ++requestId };
    requests = [...requests, request];
    dispatch({ type: 'request-sent', request });
    dispatch({ type: 'reply', request, message: { type: 'reply', id: request.id, ok: true,
      snapshot: carrierSnapshot(ui, { runState, ...(runState === 'paused' ? { stop: { reasons: ['user'], world: ui.world! } } : {}) }) } });
    presentationVersion++;
  }
  function currentLifeKinDeath(): void {
    const tick = (BigInt(ui.tick!) + 1n).toString();
    const event = kinDeath('920', { tick, actorContext: actorContext(ui.world!.player.body!) });
    ui = deliver(ui, memorialFacts(ui, [event]), undefined, { tick });
  }
  function pendingDream(): void {
    ui = deliver(ui, batch({ dreams: [{ eventId: '913', inputSeq: '46', tick: ui.tick!,
      ghost: 2, dreamer: 4, intent: 'warn', price: '20' }] }));
  }
  function result(exact: boolean): void {
    const node = exact ? ui.actions.slice().reverse().find(action => action.choice !== undefined)?.choice?.node : choiceNode('999');
    if (node === undefined) throw Error('Exact Chronicle delivery needs an admitted choice');
    const record = choiceChronicle(node.id, String(chronicleIndex++), { tick: ui.tick!, stakes: node.stakes,
      actorContext: actorContext(ui.world!.player.body ?? ui.world!.player_wait!.ghost) });
    ui = deliver(ui, batch({ chronicle: [record] }));
  }
  function replaceWorld(): void {
    const next = createCarrierState(baseline, ui.worldId + 1);
    const request: Request = { type: 'create-world', id: ++requestId, seed: '1', config: '{}' };
    requests = [...requests, request];
    dispatch({ type: 'request-sent', request });
    dispatch({ type: 'reply', request, message: { type: 'reply', id: request.id, ok: true,
      world: next.world!, snapshot: carrierSnapshot(next) } });
  }

  onMount(() => {
    const evidence = { read: () => ({ source: carrierSource, assets: sprites === null ? 'pending' : 'ready',
      ui: { worldId: ui.worldId, tick: ui.tick, checksum: ui.checksum, runState: ui.runState, world: ui.world,
        actions: ui.actions, phase: currentLifePhase(ui.notebook, ui.world), notebook: exportNotebook(ui.notebook),
        memorial: ui.memorial === null ? null : { identity: ui.memorial.entry.identity, capture: ui.memorial.capture,
          lines: memorialKeyScene(ui.memorial.capture).lines },
        scene: ui.scene === null ? null : { worldId: ui.scene.worldId, tick: ui.scene.tick,
          entries: ui.scene.entries.map(entry => ({ identity: entry.identity, kind: entry.kind, node: entry.node,
            source: entry.keyScene?.source ?? null })) },
        settledScene: ui.settledScene?.entry.identity ?? null,
        result: choiceResult(ui), slips: operationStates(ui) }, callbacks, requests }) };
    Object.defineProperty(window, '__lifecycleFixture', { value: evidence, configurable: true });
    void loadLifeSprites().then(value => { sprites = value; }).catch(error => { assetError = String(error); });
    return () => { Reflect.deleteProperty(window, '__lifecycleFixture'); };
  });
</script>

<main>
  <h1>COMPONENT-ONLY lifecycle carrier</h1>
  <p>{carrierSource.limits}</p>
  <details><summary>Constructed carrier controls</summary>
    <div role="group" aria-label="Component-only factual deliveries">
      <button onclick={() => { ui = deliver(ui, memorialFacts(ui)); }}>Deliver kin Death</button>
      <button onclick={currentLifeKinDeath}>Deliver current-life kin Death</button>
      <button onclick={pendingDream}>Deliver pending Dream</button>
      <button disabled={prePlayClose === null} onclick={() => { if (prePlayClose !== null) sceneCallback('close', prePlayClose); }}>Deliver pre-Play scene Close</button>
      <button onclick={() => { ui = deliver(ui, batch({ events: [estate()] })); }}>Deliver exact Estate</button>
      <button onclick={() => { ui = deliver(ui, batch({ events: [estate('903', { causedBy: ['899'] })] })); }}>Deliver unrelated Estate</button>
      <button onclick={() => { ui = deliver(ui, batch({ events: [kinDeath(), estate()] })); }}>Redeliver Death and Estate</button>
      <button onclick={() => { ui = offerChoice(ui, choiceNode('121', ui.world!.player.body!)); }}>Deliver next choice</button>
      <button onclick={() => result(false)}>Deliver unrelated Chronicle</button>
      <button onclick={() => result(true)}>Deliver exact Chronicle</button>
      <button onclick={() => { ui = playerDeath(ui); }}>Deliver player death</button>
      <button onclick={() => { ui = playerRebirth(ui); }}>Deliver player rebirth</button>
      <button onclick={replaceWorld}>Deliver replacement World</button>
      <button onclick={() => playback('running')}>Deliver Play acknowledgement</button>
      <button onclick={() => playback('paused')}>Deliver ordinary Stop</button>
    </div>
  </details>
  <output aria-label="Carrier asset readiness">{assetError ?? (sprites === null ? 'Loading' : 'Ready')}</output>
  <LifeSurface {ui} {sprites} {feedback} {presentationVersion} {onChoose} {onDream} {onClaim} {onBribe} {onHaunt}
    onForm={(form: UnderworldForm) => dispatch({ type: 'underworld-form', form })}
    onClose={(expected: SceneClose) => sceneCallback('close', expected)}
    onSettled={(expected: SceneClose) => sceneCallback('settled', expected)} />
</main>

<style>
  main { max-width: 1280px; margin: 0 auto; padding: 20px; }
  details { margin-bottom: 16px; }
  [role='group'] { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  output { display: block; margin-bottom: 12px; }
</style>
