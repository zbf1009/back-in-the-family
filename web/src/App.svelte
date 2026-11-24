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
  // The page keeps the shell controls and renders town, identity, choices and
  // Chronicle from reducer-owned World Snapshots. Choices submit one option;
  // only the existing Run and Step controls advance the simulation (R10.10).
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
  import TownView from './ui/TownView.svelte';
  import IdentityPanel from './ui/IdentityPanel.svelte';
  import ChoicePanel from './ui/ChoicePanel.svelte';
  import UnderworldPanel from './ui/UnderworldPanel.svelte';
  import Funeral from './ui/scenes/Funeral.svelte';
  import Inheritance from './ui/scenes/Inheritance.svelte';
  import Dream from './ui/scenes/Dream.svelte';
  import Birth from './ui/scenes/Birth.svelte';
  import { claimRequest, dreamRequest, type UnderworldForm } from './main/customization.ts';
  import { feedbackView, underworldView } from './main/view-model.ts';
  import ChroniclePanel from './ui/ChroniclePanel.svelte';
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

  // Worker Snapshot.playerNode disables Run/Step until an accepted choice;
  // the Worker enforces the same gate even for direct harness requests.
  const buttons = $derived(controls(ui));
  const currentScene = $derived(ui.scene?.entries[0] ?? null);
  const held = $derived(decisionBusy(ui));
  const notice = $derived(decisionNotice(ui));
  const decision = $derived(currentDecision(ui));
  const feedback = $derived(feedbackView(ui));
  const onClose = $derived.by(() => {
    const queue = ui.scene;
    const entry = queue?.entries[0];
    return () => {
      if (queue !== null && entry !== undefined) dispatch({ type: 'scene-close',
        expected: { worldId: queue.worldId, tick: queue.tick, entry } });
    };
  });

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

<main>
  <h1>Back in the Family</h1>
  <div class="play-layout">
    <aside class="left-column">
      <IdentityPanel {ui} />
      <ChroniclePanel {ui} />
    </aside>
    <div class="centre-column">


  <section class="controls">
    <button type="button" data-testid="create" disabled={!buttons.create} onclick={onCreate}>
      Create
    </button>
    <button type="button" data-testid="run" disabled={!buttons.run} onclick={onRun}>Run</button>
    <button type="button" data-testid="pause" disabled={!buttons.pause} onclick={onPause}>
      Pause
    </button>
    <button type="button" data-testid="step" disabled={!buttons.step} onclick={onStep}>Step</button>

    <label>
      Speed
      <select data-testid="speed" disabled={held} value={ui.speed} onchange={onSpeedChange}>
        {#each SPEEDS as speed (speed)}
          <option value={speed}>{speed}</option>
        {/each}
      </select>
    </label>
  </section>

  <div class="town-stage">
    <TownView {ui} />
    {#if currentScene !== null && currentScene.kind !== 'choice'}
      <div class="scene-slot">
        {#if currentScene.kind === 'funeral'}<Funeral {ui} {onClose} />
        {:else if currentScene.kind === 'inheritance'}<Inheritance {ui} {onClose} />
        {:else if currentScene.kind === 'dream'}<Dream {ui} {onClose} />
        {:else}<Birth {ui} {onClose} />{/if}
      </div>
    {/if}
  </div>

  <section class="status">
    <div>
      <span class="label">Tick</span>
      <span data-testid="tick">{formatTick(ui)}</span>
    </div>
    <div>
      <span class="label">Checksum</span>
      <span data-testid="checksum">{formatChecksum(ui)}</span>
    </div>
    <div>
      <span class="label">Run_State</span>
      <span data-testid="run-state">{formatRunState(ui)}</span>
    </div>
    <div>
      <span class="label">Ticks_Per_Second</span>
      <span data-testid="tps">{formatTps(ui)}</span>
    </div>
  </section>
  <section class="decision-controls" aria-label="Decision controls" data-testid="decision-controls">
    <label>Decision wait (seconds)
      <select data-testid="decision-wait" value={ui.decision?.waitSeconds ?? DEFAULT_DECISION_WAIT_SECONDS} onchange={onWaitChange}>
        {#each Array.from({ length: 11 }, (_, seconds) => seconds) as seconds (seconds)}
          <option value={seconds}>{seconds === 0 ? '0 — rules immediately' : seconds}</option>
        {/each}
      </select>
    </label>
    {#if ui.decision?.pending?.worldId === ui.worldId}
      <button type="button" data-testid="use-rules-now" onclick={onUseRules}>Use rules now</button>
    {/if}
    <p role="status" data-testid="decision-notice" data-outcome={held ? 'pending' : notice === null ? '' : ui.decision?.outcome?.kind ?? ''}>
      {held ? 'Decision pending. Time is held.' : notice ?? ''}
    </p>
    {#if ui.decision !== null}
      <p class="decision-diagnostics" data-testid="decision-diagnostics">Config: {ui.decision.config} · {ui.decision.enabled ? 'enabled' : 'disabled'} · Requests: {ui.decision.spent}/{ui.decision.sessionCap ?? '—'}</p>
    {/if}
    {#if ui.world !== null && ui.world.tick !== ui.tick}
      <p data-testid="world-as-of">World resources and eligibility as of tick {ui.world.tick}.</p>
    {/if}
    {#each feedback.actions as action, index (action.requestId ?? `input-${action.inputSeq}-${index}`)}
      <p role="status" data-testid="action-feedback" data-phase={action.phase}>{action.text}</p>
    {/each}
    {#if feedback.settledOmitted > 0}
      <p data-testid="settled-omitted">{feedback.settledOmitted} older settled results omitted. Chronicle remains available.</p>
    {/if}
    {#each feedback.playerLifecycle as fact (fact.event)}
      <p data-testid="lifecycle-feedback">{fact.kind} at tick {fact.tick}: {fact.name} · body {fact.body} · {fact.origin} · event {fact.event}</p>
    {/each}
  </section>
  <section class="inputs">
    <label>
      Seed
      <input
        type="text"
        inputmode="numeric"
        data-testid="seed"
        bind:value={seed}
        placeholder="0 to 18446744073709551615"
      />
    </label>

    <label>
      World_Config
      <textarea data-testid="config" rows="4" bind:value={config}></textarea>
    </label>

    {#if ui.seedMessage !== null}
      <p class="seed-message" data-testid="seed-message">{ui.seedMessage}</p>
    {/if}
  </section>

  {#if ui.error !== null && ui.world?.player.place !== 'waiting'}
    <p class="error" data-testid="error">{ui.error}</p>
  {:else}
    <p class="error" data-testid="error"></p>
  {/if}
    </div>
    <aside class="right-column">
      {#if ui.world?.player.place === 'waiting'}
        <UnderworldPanel {ui} {onForm} {onDream} {onClaim} />
      {/if}
      {#if decision !== null || ui.world?.player.place !== 'waiting'}
        <ChoicePanel {ui} onChoose={onChoose} />
      {/if}
    </aside>
  </div>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f8f7f2; color: #252525; font-family: system-ui, sans-serif; font-size: 14px; }
  :global(::selection) { background: #d7d2bd; color: #111111; }
  :global(:focus-visible) { outline: 2px solid #252525; outline-offset: 3px; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; color: inherit; border: 1px solid #858585; border-radius: 4px; background: #fffefa; }
  :global(button) { cursor: pointer; padding: 6px 10px; font-weight: 600; border-color: #65645e; background: #e2e0d9; }
  :global(button:hover:not(:disabled)) { background: #d0cdc0; }
  :global(button:disabled) { color: #65645e; background: #eeede6; cursor: not-allowed; }
  :global(input), :global(textarea), :global(select) { padding: 5px 7px; caret-color: #252525; }
  :global([role="region"]) { scrollbar-color: #858585 #eeede6; scrollbar-width: thin; }
  main { max-width: 1280px; margin: 0 auto; }
  h1 { margin: 0; height: 40px; padding: 8px 16px; font-size: 20px; line-height: 24px; border-bottom: 1px solid #c6c3b9; }
  .play-layout { display: grid; grid-template-columns: 300px 620px 360px; }
  .left-column { display: grid; grid-template-rows: 390px 290px; min-height: 0; border-right: 1px solid #c6c3b9; }
  .centre-column { min-width: 0; }
  .right-column { border-left: 1px solid #c6c3b9; }
  .town-stage { position: relative; }
  .scene-slot { position: absolute; top: 12px; left: 24px; right: 24px; z-index: 1; }
  .controls { height: 40px; display: flex; align-items: center; gap: 8px; padding: 3px 12px; }
  .controls label { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .status { padding: 12px 16px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .label { color: #54534f; margin-right: 8px; }
  .inputs { display: flex; flex-wrap: wrap; align-items: start; gap: 12px; padding: 10px 16px 0; font-size: 12px; }
  .inputs label { display: flex; flex-direction: column; gap: 5px; }
  .inputs input { width: 245px; }
  .inputs textarea { width: 290px; height: 55px; resize: vertical; }
  .seed-message, .error { color: #9b2520; }
  .seed-message { margin: 0; }
  .error { margin: 8px 16px; font-size: 12px; overflow-wrap: anywhere; }
  .error:empty { margin: 0; }
  .decision-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 4px 16px 0; font-size: 12px; }
  .decision-controls label { display: flex; align-items: center; gap: 6px; }
  .decision-controls select { width: 155px; }
  .decision-controls p { margin: 0; }
  .decision-diagnostics { width: 100%; color: #54534f; font-variant-numeric: tabular-nums; }
  @media (max-width: 1279px) {
    .play-layout { grid-template-columns: minmax(240px, 300px) minmax(0, 620px); }
    .right-column { grid-column: 1 / -1; border-top: 1px solid #c6c3b9; }
  }
  @media (max-width: 720px) {
    .play-layout { display: flex; flex-direction: column; }
    .centre-column { order: -1; border: 0; }
    .left-column { grid-template-rows: 340px 240px; }
    .inputs textarea { max-width: 100%; }
  }
</style>
