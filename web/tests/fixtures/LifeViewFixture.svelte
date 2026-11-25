<script lang="ts">
  import { onMount } from 'svelte';
  import LifeSurface from '../../src/ui/LifeSurface.svelte';
  import { loadLifeSprites, type SpriteSet } from '../../src/art/sprites.ts';
  import { reduce, type UiState } from '../../src/main/ui-state.ts';
  import { feedbackView } from '../../src/main/view-model.ts';
  import { claimRequest, dreamRequest, type UnderworldForm } from '../../src/main/customization.ts';
  import type { PlayerOption, Slot } from '../../src/shared/world-snapshot.ts';
  import type { Request, Snapshot } from '../../src/shared/protocol.ts';
  import type { SceneClose } from '../../src/main/scene-queue.ts';

  const { initialUi, scenario, source }: {
    initialUi: UiState; scenario: string;
    source: { baseline: string; modifiedFields: string[]; limits: string; capacity: string; capacitySources: string[] };
  } = $props();
  let ui = $state(initialUi);
  let sprites = $state<SpriteSet | null>(null);
  let assetError = $state<string | null>(null);
  let callbacks = $state<Record<string, unknown>[]>([]);
  const draws: { method: 'resident' | 'grave'; canvas: string | undefined; visual: string | null }[] = [];
  const feedback = $derived(feedbackView(ui));
  const motion = scenario.startsWith('motion-');
  let pendingChoice = $state<{ worldId: number; request: Extract<Request, { type: 'choose' }> } | null>(null);
  let capturedClose: SceneClose | null = null;
  function status(): Snapshot {
    return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum, tps: ui.tps, speed: ui.speed,
      actions: [], playerLifecycle: [], playerNode: ui.playerNode };
  }
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
    if (motion) {
      const request: Extract<Request, { type: 'choose' }> = { type: 'choose', id: callbacks.length, node, option };
      pendingChoice = { worldId, request };
      ui = reduce(ui, { type: 'request-sent', request, worldId });
    }
  }
  function finishChoice(accepted: boolean): void {
    if (pendingChoice === null) return;
    const { request, worldId } = pendingChoice;
    record({ kind: 'fixture-choice-props', accepted, worldId, node: request.node });
    // Explicit component-only acknowledgment props exercise presentation. There
    // is no Worker, input sequence, receipt, native admission or applied effect.
    const exactNode = worldId === ui.worldId && ui.playerNode.pending && ui.playerNode.node === request.node;
    const snapshot = { ...status(), worldId, playerNode: accepted && exactNode ? { pending: true as const, node: request.node, answered: true } : ui.playerNode };
    ui = reduce(ui, { type: 'reply', request, worldId, message: accepted
      ? { type: 'reply', id: request.id, ok: true, snapshot }
      : { type: 'reply', id: request.id, ok: false, kind: 'rejected', error: 'option_not_in_set', snapshot } });
    pendingChoice = null;
  }
  function onBribe(worldId: number, amount: string): void { record({ kind: 'bribe', worldId, amount }); }
  function onHaunt(worldId: number, target: number): void { record({ kind: 'haunt', worldId, target }); }
  function onClose(expected: SceneClose): void {
    record({ kind: 'close', worldId: expected.worldId, tick: expected.tick, identity: expected.entry.identity });
    capturedClose = expected;
    ui = reduce(ui, { type: 'scene-close', expected });
  }
  function repeatClose(): void {
    if (capturedClose === null) return;
    record({ kind: 'fixture-late-close', identity: capturedClose.entry.identity });
    ui = reduce(ui, { type: 'scene-close', expected: capturedClose });
  }
  function replacePresentation(change: 'duplicate' | 'tick' | 'node' | 'world'): void {
    const world = structuredClone($state.snapshot(ui.world!));
    const worldId = change === 'world' ? ui.worldId + 1 : ui.worldId;
    if (change === 'tick') world.tick = String(BigInt(world.tick) + 1n);
    if (change === 'node' && world.player_node !== null) world.player_node.id = String(BigInt(world.player_node.id) + 1n);
    record({ kind: 'fixture-presentation-props', change, worldId, tick: world.tick });
    const next = change === 'world' ? { ...initialUi, worldId, world, tick: world.tick, scene: null, sceneEpisode: null, actions: [] }
      : { ...ui, world, tick: world.tick, playerNode: world.player_node === null ? { pending: false as const } : { pending: true as const, node: world.player_node.id, answered: false } };
    ui = reduce(next, { type: 'status', snapshot: { ...status(), worldId, tick: world.tick, playerNode: next.playerNode,
      playerLifecycle: initialUi.playerLifecycle,
      stop: { world, reasons: initialUi.scene?.reasons ?? ['player_node'] } } });
  }
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
    evidenceWindow.__lifeViewFixture = { read: () => structuredClone($state.snapshot({ mode: 'COMPONENT-ONLY', scenario, source, ui, callbacks, draws, assetState: assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready' })) };
    void loadLifeSprites().then(value => {
      sprites = scenario.startsWith('event-') || motion ? {
        ...value,
        resident(...args: Parameters<SpriteSet['resident']>) {
          draws.push({ method: 'resident', canvas: args[0].canvas.dataset.testid, visual: args[4] });
          value.resident(...args);
        },
        grave(...args: Parameters<SpriteSet['grave']>) {
          draws.push({ method: 'grave', canvas: args[0].canvas.dataset.testid, visual: null });
          value.grave(...args);
        },
      } : value;
    }).catch(error => {
      assetError = error instanceof Error ? error.message : String(error);
    });
    return () => { delete evidenceWindow.__lifeViewFixture; };
  });
</script>

<main data-testid="component-fixture" data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header class="fixture-label" data-testid="fixture-label">
    <h1>COMPONENT-ONLY — LifeSurface</h1>
    <p>{scenario === 'motion-native' ? 'Actual native-controlled fixture DTOs rendered by production components, shared life.css and the real atlas loader. No live App/WASM or native UI admission is claimed.' : 'Actual production components, shared life.css and atlas loader. Constructed presentation data and labeled local reducer props; never native admission, receipts, success or gameplay results.'}</p>
    <p>{scenario} · {source.baseline}</p>
  </header>
  {#if assetError !== null}<p role="alert" data-testid="fixture-art-error">Visual assets unavailable: {assetError}. Factual text and callback controls remain available.</p>
  {:else if sprites === null}<p role="status" data-testid="fixture-art-loading">Loading visual assets.</p>{/if}
  <LifeSurface {ui} {sprites} {feedback} {onChoose} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} {onClose} />
  {#if motion}
    <details class="fixture-records" data-testid="fixture-motion-controls">
      <summary>COMPONENT-ONLY presentation reducer controls</summary>
      <p>Explicit test props exercise queue and callback guards, not native simulation or input processing.</p>
      <button type="button" data-testid="fixture-reject-choice" disabled={pendingChoice === null} onclick={() => finishChoice(false)}>Reject constructed Choose props</button>
      <button type="button" data-testid="fixture-accept-choice" disabled={pendingChoice === null} onclick={() => finishChoice(true)}>Acknowledge constructed Choose props</button>
      <button type="button" data-testid="fixture-late-close" onclick={repeatClose}>Deliver captured Close again</button>
      <button type="button" data-testid="fixture-duplicate-stop" onclick={() => replacePresentation('duplicate')}>Repeat constructed stop props</button>
      <button type="button" data-testid="fixture-next-tick" onclick={() => replacePresentation('tick')}>Replace constructed tick props</button>
      <button type="button" data-testid="fixture-next-node" onclick={() => replacePresentation('node')}>Replace constructed node props</button>
      <button type="button" data-testid="fixture-next-world" onclick={() => replacePresentation('world')}>Replace constructed World props</button>
    </details>
  {/if}
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
    <p>Forms and labeled presentation controls fold through the actual reducer. No Worker, native World or input sequence is written by callbacks.</p>
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
