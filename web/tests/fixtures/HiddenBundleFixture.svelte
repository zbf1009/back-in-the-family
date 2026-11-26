<script lang="ts">
  import { onMount } from 'svelte';
  import baselineBytes from '../../../fixtures/parity/seed1-pairwise.snapshot-500.json?raw';
  import LifeSurface from '../../src/ui/LifeSurface.svelte';
  import { loadLifeSprites, type SpriteSet } from '../../src/art/sprites.ts';
  import { initialUiState, reduce, type UiState } from '../../src/main/ui-state.ts';
  import type { SceneClose } from '../../src/main/scene-queue.ts';
  import type { UnderworldForm } from '../../src/main/customization.ts';
  import { feedbackView } from '../../src/main/view-model.ts';
  import type { Snapshot } from '../../src/shared/protocol.ts';
  import type { PlayerLifecycleFact, PlayerOption, Slot, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

  const baseline = JSON.parse(baselineBytes) as WorldSnapshot;
  const source = {
    baseline: 'fixtures/parity/seed1-pairwise.snapshot-500.json',
    modifiedFields: ['Canonical decimal Soul IDs', 'Constructed Waiting carrier', 'Ordered rebuild-arrival and death facts for one historical body'],
    limits: 'COMPONENT-ONLY construction. Not live App/WASM, native admission, a receipt, replay, or gameplay evidence.',
  };
  const arrivalOnly = new URLSearchParams(location.search).get('state') === 'arrival-only';
  let sequence = 0;
  let facts: PlayerLifecycleFact[] = [];
  let ui = $state.raw<UiState>(makeBundle(1, baseline.tick, arrivalOnly));
  let sprites = $state.raw<SpriteSet | null>(null);
  let assetError = $state<string | null>(null);
  let callbacks = $state.raw<Record<string, unknown>[]>([]);
  const feedback = $derived(feedbackView(ui));

  function soulId(value: string): string {
    return /^S-[0-9]+$/.test(value) ? BigInt(value.slice(2)).toString() : value;
  }
  function status(state: UiState, lifecycle: PlayerLifecycleFact[]): Snapshot {
    return { worldId: state.worldId, runState: state.runState, tick: state.tick, checksum: state.checksum,
      tps: state.tps, speed: state.speed, actions: [], playerNode: state.playerNode, playerLifecycle: lifecycle,
      stop: { world: state.world!, reasons: lifecycle.length === 1 ? ['player_reborn'] : ['player_reborn', 'player_died'] } };
  }
  function makeBundle(worldId: number, tick: string, onlyArrival = false): UiState {
    const world = structuredClone(baseline);
    world.tick = tick;
    world.player_soul = soulId(world.player_soul);
    for (const person of world.residents) person.soul_id = soulId(person.soul_id);
    for (const soul of world.souls) soul.soul_id = soulId(soul.soul_id);
    for (const account of world.joss) account.soul_id = soulId(account.soul_id);
    world.magistrate.soul_id = soulId(world.magistrate.soul_id);
    const priorBody = world.residents.find(person => person.id === world.player.body)!;
    const arrival: PlayerLifecycleFact = { event: String(9007199254740993n + BigInt(sequence) * 2n),
      tick, kind: 'rebuild', body: 500001 + sequence, name: `Fixture Arrival ${sequence}`, origin: 'rebuilt' };
    facts = [arrival, { ...arrival, event: String(BigInt(arrival.event) + 1n), kind: 'death' }];
    world.residents = world.residents.filter(person => person.id !== priorBody.id);
    world.households = world.households.map(house => ({ ...house, members: house.members.filter(id => id !== priorBody.id) }));
    world.souls.find(soul => soul.soul_id === world.player_soul)!.place = { waiting: { since: tick } };
    world.player.place = 'waiting';
    world.player.body = null;
    world.player.relations = [];
    world.player.earlier_bodies = [...world.player.earlier_bodies,
      { id: priorBody.id, name: priorBody.name, origin: priorBody.origin, death: tick },
      { id: arrival.body, name: arrival.name, origin: arrival.origin, death: tick }];
    world.person_names = [...world.person_names, { id: arrival.body, name: arrival.name }];
    world.player_wait = { ghost: arrival.body, access_from: tick, claim: null, carry_over: null };
    world.player_node = null;
    world.underworld_view = null;
    world.birth_slots = [];
    world.standing_slots = [];
    const initial = { ...initialUiState(), worldId, tick, world, runState: 'paused' as const };
    return reduce(initial, { type: 'status', snapshot: status(initial, onlyArrival ? facts.slice(0, 1) : facts) });
  }
  function record(value: Record<string, unknown>): void { callbacks = [...callbacks, value]; }
  function onSettled(expected: SceneClose): void {
    ui = reduce(ui, { type: 'scene-settled', expected });
    record({ kind: 'settled', identity: expected.entry.identity, accepted: ui.settledScene?.entry === expected.entry });
  }
  function onClose(expected: SceneClose): void {
    const settled = ui.settledScene?.entry === expected.entry;
    const previous = ui;
    ui = reduce(ui, { type: 'scene-close', expected });
    record({ kind: 'close', identity: expected.entry.identity, settled, accepted: ui !== previous });
  }
  function appendDeath(): void {
    record({ kind: 'fixture-props', change: 'append-death' });
    ui = reduce(ui, { type: 'status', snapshot: status(ui, facts) });
  }
  function replaceBundle(change: 'tick' | 'world'): void {
    const worldId = change === 'world' ? ui.worldId + 1 : ui.worldId;
    const tick = change === 'tick' ? String(BigInt(ui.tick!) + 1n) : ui.tick!;
    sequence++;
    record({ kind: 'fixture-props', change, worldId, tick });
    ui = makeBundle(worldId, tick);
  }
  function onForm(form: UnderworldForm): void { record({ kind: 'form' }); ui = reduce(ui, { type: 'underworld-form', form }); }
  async function onChoose(worldId: number, node: string, option: PlayerOption): Promise<void> { record({ kind: 'choose', worldId, node, option }); }
  async function onDream(): Promise<void> { record({ kind: 'dream' }); }
  async function onClaim(slot: Slot): Promise<void> { record({ kind: 'claim', slot }); }
  function onBribe(worldId: number, amount: string): void { record({ kind: 'bribe', worldId, amount }); }
  function onHaunt(worldId: number, target: number): void { record({ kind: 'haunt', worldId, target }); }

  onMount(() => {
    const evidenceWindow = window as Window & { __hiddenBundleFixture?: { read(): unknown } };
    evidenceWindow.__hiddenBundleFixture = { read: () => structuredClone($state.snapshot({ mode: 'COMPONENT-ONLY', source,
      ui: { worldId: ui.worldId, tick: ui.tick, world: ui.world, scene: ui.scene, settledScene: ui.settledScene, actions: ui.actions }, callbacks })) };
    void loadLifeSprites().then(value => { sprites = value; }).catch(error => {
      assetError = error instanceof Error ? error.message : String(error);
    });
    return () => { delete evidenceWindow.__hiddenBundleFixture; };
  });
</script>

<main data-testid="hidden-bundle-fixture" data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header>
    <h1>COMPONENT-ONLY — hidden scene bundle</h1>
    <p>Constructed ordered arrival/death props render through production LifeSurface, KeyScene, reducer, shared life.css and the real atlas loader. No live simulation, native admission, receipt or gameplay result is claimed.</p>
  </header>
  {#if assetError !== null}<p role="alert">Visual assets unavailable: {assetError}</p>{/if}
  <LifeSurface {ui} {sprites} {feedback} {onChoose} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} {onClose} {onSettled} />
  <section aria-label="Constructed fixture props">
    <p>Explicit local presentation props only; these controls never submit a simulation action.</p>
    <button type="button" data-testid="fixture-append-death" onclick={appendDeath}>Append constructed death props</button>
    <button type="button" data-testid="fixture-next-bundle" onclick={() => replaceBundle('tick')}>Replace constructed tick bundle</button>
    <button type="button" data-testid="fixture-next-world" onclick={() => replaceBundle('world')}>Replace constructed World bundle</button>
  </section>
  <pre data-testid="fixture-callbacks">{JSON.stringify(callbacks, null, 2)}</pre>
  <pre data-testid="fixture-source">{JSON.stringify(source, null, 2)}</pre>
</main>

<style>
  main { max-width: 1400px; margin: 0 auto; padding: 20px; }
  header { margin-bottom: 20px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
