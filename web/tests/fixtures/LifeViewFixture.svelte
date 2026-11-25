<script lang="ts">
  import { onMount } from 'svelte';
  import LifeSurface from '../../src/ui/LifeSurface.svelte';
  import { loadLifeSprites, type SpriteSet } from '../../src/art/sprites.ts';
  import { reduce, type UiState } from '../../src/main/ui-state.ts';
  import { feedbackView } from '../../src/main/view-model.ts';
  import { claimRequest, dreamRequest, type UnderworldForm } from '../../src/main/customization.ts';
  import type { PlayerOption, Slot } from '../../src/shared/world-snapshot.ts';

  const { initialUi, scenario, source }: {
    initialUi: UiState; scenario: string;
    source: { baseline: string; modifiedFields: string[]; limits: string; capacity: string; capacitySources: string[] };
  } = $props();
  let ui = $state(initialUi);
  let sprites = $state<SpriteSet | null>(null);
  let assetError = $state<string | null>(null);
  let callbacks = $state<Record<string, unknown>[]>([]);
  const feedback = $derived(feedbackView(ui));
  function record(value: Record<string, unknown>): void {
    callbacks = [...callbacks, $state.snapshot(value)];
  }
  function onForm(form: UnderworldForm): void {
    record({ kind: 'form', worldId: ui.worldId, form });
    ui = reduce(ui, { type: 'underworld-form', form });
  }
  async function onDream(): Promise<void> {
    record({ kind: 'dream', worldId: ui.worldId, form: ui.underworldForm, request: dreamRequest(ui.world!, ui.underworldForm) });
  }
  async function onClaim(slot: Slot): Promise<void> {
    record({ kind: 'claim', worldId: ui.worldId, slot, form: ui.underworldForm, request: claimRequest(ui.underworldForm, slot) });
  }
  async function onChoose(worldId: number, node: string, option: PlayerOption): Promise<void> {
    record({ kind: 'choose', worldId, node, option });
  }
  function onBribe(worldId: number, amount: string): void { record({ kind: 'bribe', worldId, amount }); }
  function onHaunt(worldId: number, target: number): void { record({ kind: 'haunt', worldId, target }); }
  function onClose(): void { record({ kind: 'close', worldId: ui.worldId }); }
  function changeCarrier(change: 'advance' | 'block' | 'remove' | 'restore' | 'generation'): void {
    const world = structuredClone($state.snapshot(ui.world!));
    const originalTarget = initialUi.world!.underworld_view!.actions.haunt.targets[0]!;
    const haunt = world.underworld_view!.actions.haunt;
    if (change === 'advance') world.tick = String(BigInt(world.tick) + 1n);
    if (change === 'block') haunt.targets = haunt.targets.map(target => target.target === originalTarget.target
      ? { target: target.target, availability: { eligible: false, reason: 'rate_limited' } } : target);
    if (change === 'remove') haunt.targets = haunt.targets.filter(target => target.target !== originalTarget.target);
    if (change === 'restore') haunt.targets = initialUi.world!.underworld_view!.actions.haunt.targets.map(target => ({ ...target, availability: { ...target.availability } }));
    const worldId = change === 'generation' ? ui.worldId + 1 : ui.worldId;
    record({ kind: 'fixture-carrier-change', change, oldWorldId: ui.worldId, worldId, tick: world.tick });
    ui = { ...ui, worldId, tick: world.tick, world };
  }

  onMount(() => {
    // Read-only fixture evidence. There is no state setter or fake admission.
    const evidenceWindow = window as Window & { __lifeViewFixture?: { read(): unknown } };
    evidenceWindow.__lifeViewFixture = { read: () => structuredClone($state.snapshot({ mode: 'COMPONENT-ONLY', scenario, source, ui, callbacks, assetState: assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready' })) };
    void loadLifeSprites().then(value => { sprites = value; }).catch(error => {
      assetError = error instanceof Error ? error.message : String(error);
    });
    return () => { delete evidenceWindow.__lifeViewFixture; };
  });
</script>

<main data-testid="component-fixture" data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header class="fixture-label" data-testid="fixture-label">
    <h1>COMPONENT-ONLY — LifeSurface</h1>
    <p>Actual production components, shared life.css and atlas loader. Constructed presentation data; callbacks record intent only, not native admission, success or gameplay results.</p>
    <p>{scenario} · {source.baseline}</p>
  </header>
  {#if assetError !== null}<p role="alert" data-testid="fixture-art-error">Visual assets unavailable: {assetError}. Factual text and callback controls remain available.</p>
  {:else if sprites === null}<p role="status" data-testid="fixture-art-loading">Loading visual assets.</p>{/if}
  <LifeSurface {ui} {sprites} {feedback} {onChoose} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} {onClose} />
  {#if initialUi.world?.underworld_view !== null && initialUi.world?.underworld_view !== undefined}
    <details class="fixture-records" data-testid="fixture-carrier-controls">
      <summary>COMPONENT-ONLY constructed carrier changes</summary>
      <p>These explicit controls replace only this mounted fixture's constructed props. They do not simulate native progression, write production App state, or submit actions.</p>
      <button type="button" data-testid="fixture-advance" onclick={() => changeCarrier('advance')}>Advance constructed tick</button>
      <button type="button" data-testid="fixture-block-target" onclick={() => changeCarrier('block')}>Mark first target rate_limited</button>
      <button type="button" data-testid="fixture-remove-target" onclick={() => changeCarrier('remove')}>Remove first target</button>
      <button type="button" data-testid="fixture-restore-target" onclick={() => changeCarrier('restore')}>Restore original targets</button>
      <button type="button" data-testid="fixture-generation" onclick={() => changeCarrier('generation')}>Change constructed World generation</button>
    </details>
  {/if}
  <details class="fixture-records" data-testid="fixture-records">
    <summary>COMPONENT-ONLY callback evidence ({callbacks.length})</summary>
    <p>Only local form changes fold through the actual reducer. No Worker, App or World is written by callbacks.</p>
    <pre data-testid="fixture-callbacks">{JSON.stringify(callbacks, null, 2)}</pre>
    <pre data-testid="fixture-source">{JSON.stringify(source, null, 2)}</pre>
  </details>
</main>

<style>
  main { max-width: 1400px; margin: 0 auto; padding: 20px; }
  .fixture-label { border-bottom: 1px solid var(--life-border); margin-bottom: 20px; padding-bottom: 16px; }
  .fixture-label h1 { font-size: 21px; }
  .fixture-records { margin-top: 28px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
</style>
