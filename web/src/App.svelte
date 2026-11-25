<script lang="ts">
  // The web shell page (R3.1-R3.3, R4.4, R4.7-R4.10, R5.1, R5.8, R9.11).
  //
  // App.svelte holds one UiState in a rune, feeds every SimClient event and user
  // action through the pure `reduce`, and renders the status fields, controls and
  // message areas from it. It owns no simulation and no worker: the SimClient is
  // constructed in main.ts and passed in as a prop, so the same client (and the
  // same Sim_Worker) is shared with the test harness (DA-3). It touches the
  // simulation only by calling SimClient methods, which send Worker_Protocol
  // messages (R2.2, R6.2).
  //
  // Life-first presentation derives from reducer-owned World Snapshots. Only
  // existing Run/Step controls advance time; artwork and disclosures do not.
  //
  // Note: the reactive state variable is named `ui`, not `state`. A variable named
  // `state` collides with the `$state` rune call (`$state(...)` reads as a store
  // auto-subscription when a `state` binding is in scope).

  import { untrack } from 'svelte';
  import type { SimClient } from './main/sim-client.ts';
  import type { EventBridge } from './main/bridge.ts';
  import type { Request, RequestWithoutId } from './shared/protocol.ts';
  import {
    initialUiState,
    reduce,
    controls,
    worldSnapshotNeeded,
    decisionBusy,
    currentDecision,
    decisionNotice,
    formatTick,
    formatChecksum,
    formatTps,
    formatRunState,
    type UiEvent,
    type UiState,
  } from './main/ui-state.ts';
  import { parseSeed } from './shared/seed.ts';
  import { isSpeed, SPEEDS } from './shared/speeds.ts';
  import type { PlayerOption, Slot } from './shared/world-snapshot.ts';
  import type { SceneClose } from './main/scene-queue.ts';
  import LifeSurface from './ui/LifeSurface.svelte';
  import { loadLifeSprites, type SpriteSet } from './art/sprites.ts';
  import './ui/life.css';
  import { claimRequest, dreamRequest, parseBribeAmount, type UnderworldForm } from './main/customization.ts';
  import { feedbackView, identitySummary, underworldView } from './main/view-model.ts';
  // World_Config field is prefilled with text identical to the fixture file
  // (R3.1). Vite's `?raw` import yields the file's bytes verbatim, so the textarea
  // starts equal to fixtures/configs/pairwise.json. The path is relative to this
  // file at web/src/App.svelte: up to web/src, up to web, up to the repo root,
  // then into fixtures/configs.
  import pairwiseConfig from '../../fixtures/configs/pairwise.json?raw';
  import { DEFAULT_DECISION_WAIT_SECONDS } from './shared/decision.ts';

  const { client, bridge }: { client: SimClient; bridge: EventBridge } = $props();

  // The single source of truth the page renders. Every event folds into it via
  // `reduce`; the control enablement and formatted fields derive from it.
  let ui: UiState = $state(initialUiState());

  // The editable fields. The seed starts empty; the config starts as the fixture.
  let seed = $state('');
  let config = $state(pairwiseConfig);
  let sprites: SpriteSet | null = $state(null);
  let assetError: string | null = $state(null);
  let setupOpen = $state(true);
  let setupWorld = 0;
  const identity = $derived(identitySummary(ui));

  // Worker Snapshot.playerNode disables Run/Step until an accepted choice;
  // the Worker enforces the same gate even for direct harness requests.
  const buttons = $derived(controls(ui));
  const activeWorld = $derived(ui.worldId);
  const held = $derived(decisionBusy(ui));
  const notice = $derived(decisionNotice(ui));
  const feedback = $derived(feedbackView(ui));
  function onClose(expected: SceneClose): void {
    dispatch({ type: 'scene-close', expected });
  }

  // Fold one event into the state. Assigning a fresh object keeps the rune reactive.
  function dispatch(event: UiEvent): void {
    ui = reduce(ui, event);
    if (worldSnapshotNeeded(ui)) void sendRequest({ type: 'world-snapshot' });
  }

  async function sendRequest(input: RequestWithoutId): Promise<void> {
    const worldId = ui.worldId;
    const tick = ui.tick;
    let request: Request | undefined;
    try {
      const ticket = client.request(input);
      request = { ...input, id: ticket.requestId } as Request;
      dispatch({ type: 'request-sent', request, worldId });
      dispatch({ type: 'reply', request, worldId, message: await ticket.reply });
    } catch (error) {
      if (request !== undefined) dispatch({ type: 'request-failed', request, worldId, error: String(error) });
      else if (input.type === 'world-snapshot' && tick !== null) {
        dispatch({ type: 'world-read-start-failed', worldId, tick, error: String(error) });
      } else if (worldId === ui.worldId) dispatch({ type: 'validation-error', error: String(error) });
    }
  }

  async function onChoose(worldId: number, node: string, option: PlayerOption): Promise<void> {
    const live = currentDecision(ui);
    if (ui.worldId !== worldId || live === null || live.id !== node || !live.options.some(entry => entry.id === option)) return;
    await sendRequest({ type: 'choose', node: live.id, option });
  }

  async function sendUnderworld(input: RequestWithoutId | null): Promise<void> {
    if (input === null || held || ui.createPending || ui.runState === 'failed' || ui.world?.player.place !== 'waiting') return;
    await sendRequest(input);
  }

  function onForm(form: UnderworldForm): void { dispatch({ type: 'underworld-form', form }); }
  async function onDream(): Promise<void> {
    if (ui.world === null || held || !underworldView(ui)?.dreamEnabled) return;
    await sendUnderworld(dreamRequest(ui.world, ui.underworldForm));
  }

  async function onWaitChange(event: Event): Promise<void> {
    const seconds = Number((event.currentTarget as HTMLSelectElement).value);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 10) return;
    await sendRequest({ type: 'set-decision-wait', seconds });
  }

  async function onUseRules(): Promise<void> {
    const pending = ui.decision?.pending;
    if (pending == null || pending.worldId !== ui.worldId) return;
    await sendRequest({ type: 'use-rules-now', requestId: pending.requestId, worldId: pending.worldId });
  }
  async function onClaim(slot: Slot): Promise<void> {
    if (!underworldView(ui)?.slots.some(entry => entry.slot === slot && entry.claimEnabled)) return;
    await sendUnderworld(claimRequest(ui.underworldForm, slot));
  }

  async function onBribe(worldId: number, amount: string): Promise<void> {
    if (worldId !== ui.worldId) return;
    const parsed = parseBribeAmount(amount);
    if (!parsed.ok) {
      dispatch({ type: 'validation-error', error: parsed.error });
      return;
    }
    if (!ui.world?.underworld_view?.actions.bribe.availability.eligible) return;
    await sendUnderworld({ type: 'bribe', amount: parsed.value });
  }

  async function onHaunt(worldId: number, target: number): Promise<void> {
    if (worldId !== ui.worldId) return;
    const entry = ui.world?.underworld_view?.actions.haunt.targets.find(entry => entry.target === target);
    if (entry?.availability.eligible !== true) return;
    await sendUnderworld({ type: 'haunt', target });
  }

  $effect(() => {
    let mounted = true;
    void loadLifeSprites().then(loaded => {
      if (mounted) sprites = loaded;
    }, error => {
      if (mounted) assetError = String(error);
    });
    return () => { mounted = false; };
  });

  $effect(() => {
    if (activeWorld !== setupWorld) {
      setupWorld = activeWorld;
      if (setupWorld !== 0) setupOpen = false;
    }
  });

  // The SimClient's worker-initiated events (status, fatal, worker error) were
  // registered on the client at construction in main.ts to forward through this
  // bridge. Point the bridge at this component's reducer while it is mounted, so a
  // `status`, `fatal` or `worker-error` becomes a UiEvent (R2.8, R2.9, R2.12).
  $effect(() => {
    bridge.dispatch = dispatch;
    // Read page-session diagnostics before creation; no simulation mutation.
    void untrack(() => sendRequest({ type: 'decision-status' }));
    return () => {
      bridge.dispatch = null;
    };
  });

  // Create: validate the seed on the Main_Thread first. An invalid seed shows the
  // validation message and sends nothing (R3.3); a valid one marks the request
  // sent (clears the seed message, disables Create) and calls createWorld with the
  // seed string exactly as entered and the config text unchanged (R3.2).
  async function onCreate(): Promise<void> {
    if (!controls(ui).create) return;
    const result = parseSeed(seed);
    if (!result.ok) {
      dispatch({ type: 'seed-invalid', problem: result.problem });
      return;
    }
    await sendRequest({ type: 'create-world', seed, config });
  }

  async function onRun(): Promise<void> {
    if (!controls(ui).run) return;
    await sendRequest({ type: 'run' });
  }

  async function onPause(): Promise<void> {
    if (!controls(ui).pause) return;
    await sendRequest({ type: 'pause' });
  }

  // Step disables itself through `controls` (stepPending) until the reply arrives (R4.10).
  async function onStep(): Promise<void> {
    if (!controls(ui).step) return;
    await sendRequest({ type: 'step' });
  }

  // Speed is a selection from the fixed SPEEDS list (R4.4); the select offers no
  // other value. Changing it sends a set-speed request.
  async function onSpeedChange(event: Event): Promise<void> {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    if (held || !isSpeed(value)) return;
    await sendRequest({ type: 'set-speed', speed: value });
  }

</script>

<main data-testid="life-app" data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header class="life-header" data-testid="life-header">
    <div class="header-identity">
      <h1>Back in the Family</h1>
      {#if identity !== null}
        <strong class="body-name" data-testid="life-name">{identity.name}</strong>
        <p><span data-testid="life-soul">Soul {identity.soul}</span> · {identity.status}
          {#if identity.body !== null} · body {identity.body}{/if}
          {#if identity.age !== null} · {identity.age} years{/if}
          {#if identity.origin !== null} · {identity.origin}{/if}
        </p>
      {:else}
        <p>Create a world to begin this Soul's life.</p>
      {/if}
    </div>
    <div class="header-actions">
      <section class="controls" aria-label="Simulation controls">
        <button type="button" data-testid="run" disabled={!buttons.run} onclick={onRun}>Run</button>
        <button type="button" data-testid="pause" disabled={!buttons.pause} onclick={onPause}>Pause</button>
        <button type="button" data-testid="step" disabled={!buttons.step} onclick={onStep}>Step</button>
        <label>Speed <select data-testid="speed" disabled={held} value={ui.speed} onchange={onSpeedChange}>
          {#each SPEEDS as speed (speed)}<option value={speed}>{speed}</option>{/each}
        </select></label>
      </section>
      <p class="clock">Tick <span data-testid="tick">{formatTick(ui)}</span> · <span data-testid="run-state">{formatRunState(ui)}</span></p>
      <a href="#current-action">Back to current action</a>
    </div>
  </header>

  <section class="decision-status" aria-label="Decision controls" data-testid="decision-controls">
    <p role="status" data-testid="decision-notice" data-outcome={held ? 'pending' : notice === null ? '' : ui.decision?.outcome?.kind ?? ''}>
      {held ? 'Decision pending. Time is held.' : notice ?? ''}
    </p>
    {#if ui.decision?.pending?.worldId === ui.worldId}
      <button type="button" data-testid="use-rules-now" onclick={onUseRules}>Use rules now</button>
    {/if}
  </section>
  {#if assetError !== null}
    <p role="alert" class="error" data-testid="art-error">Visual assets unavailable: {assetError}. Factual text and actions remain available.</p>
  {:else if sprites === null}
    <p role="status" class="muted" data-testid="art-loading">Loading selected scene art…</p>
  {/if}
  {#if ui.error !== null && ui.world?.player.place !== 'waiting'}
    <p class="error" data-testid="error">{ui.error}</p>
  {:else}<p class="error" data-testid="error"></p>{/if}

  {#if ui.world !== null}
    <LifeSurface {ui} {sprites} {feedback} {onChoose} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} {onClose} />
  {:else}
    <section id="current-action" class="begin-life" tabindex="-1">
      <h2>A life is waiting to begin</h2>
      <p>Create a world below. Run and Step advance time; choices and underworld actions are recorded before they take effect.</p>
    </section>
  {/if}

  <section class="setup-and-details" aria-label="World setup and technical information">
    <details data-testid="world-setup" bind:open={setupOpen}>
      <summary>World setup — Create, Seed and World_Config</summary>
      <div class="inputs">
        <label>Seed <input type="text" inputmode="numeric" data-testid="seed" bind:value={seed} placeholder="0 to 18446744073709551615" /></label>
        <label class="config-input">World_Config <textarea data-testid="config" rows="4" bind:value={config}></textarea></label>
      </div>
      {#if ui.seedMessage !== null}<p class="error" data-testid="seed-message">{ui.seedMessage}</p>{/if}
      <button type="button" data-testid="create" disabled={!buttons.create} onclick={onCreate}>Create</button>
      <p class="muted">A successful Create replaces the current world; local disclosures do not advance time.</p>
    </details>
    <details data-testid="technical-details">
      <summary>Technical and decision details</summary>
      <div class="technical-fields">
        <p>Checksum <span data-testid="checksum">{formatChecksum(ui)}</span></p>
        <p>Ticks_Per_Second <span data-testid="tps">{formatTps(ui)}</span></p>
        <label>Decision wait (seconds)
          <select data-testid="decision-wait" value={ui.decision?.waitSeconds ?? DEFAULT_DECISION_WAIT_SECONDS} onchange={onWaitChange}>
            {#each Array.from({ length: 11 }, (_, seconds) => seconds) as seconds (seconds)}
              <option value={seconds}>{seconds === 0 ? '0 — rules immediately' : seconds}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if ui.decision !== null}
        <p class="muted" data-testid="decision-diagnostics">Config: {ui.decision.config} · {ui.decision.enabled ? 'enabled' : 'disabled'} · Requests: {ui.decision.spent}/{ui.decision.sessionCap ?? '—'}</p>
      {/if}
    </details>
  </section>
</main>

<style>
  main { max-width: 1240px; margin: 0 auto; padding: 20px 24px 32px; }
  .life-header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--life-border); margin-bottom: 16px; }
  .header-identity { min-width: 0; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .body-name { font-size: 24px; line-height: 1.3; display: block; }
  .header-identity p, .clock { margin: 6px 0 0; }
  .header-actions { flex-shrink: 0; }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .controls label { display: flex; align-items: center; gap: 6px; }
  .clock { font-variant-numeric: tabular-nums; }
  .header-actions a { display: inline-block; margin-top: 6px; }
  .decision-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
  .decision-status p { margin: 0; }
  .decision-status p:empty { display: none; }
  .muted { color: var(--life-muted); }
  .error { color: var(--life-event); overflow-wrap: anywhere; }
  .error:empty { margin: 0; }
  .begin-life { max-width: 70ch; margin: 28px 0; }
  .begin-life h2 { margin: 0 0 12px; }
  .setup-and-details { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--life-border); }
  .setup-and-details details + details { margin-top: 12px; }
  .inputs { display: flex; flex-wrap: wrap; gap: 16px; margin: 12px 0; }
  .inputs label { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .inputs input { width: 300px; }
  .config-input { flex: 1; flex-basis: 420px; }
  .inputs textarea { width: 100%; min-height: 100px; }
  .technical-fields { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; }
  .technical-fields p { margin: 8px 0; font-variant-numeric: tabular-nums; }
  .technical-fields span { overflow-wrap: anywhere; }
  .technical-fields label { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  @media (max-width: 800px) {
    main { padding: 16px; }
    .life-header { display: block; }
    .header-actions { margin-top: 16px; }
    .body-name { font-size: 22px; }
  }
</style>
