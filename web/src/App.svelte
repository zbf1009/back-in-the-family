<script lang="ts">
  import { untrack } from 'svelte';
  import type { SimClient, ReplyMessage } from './main/sim-client.ts';
  import type { EventBridge } from './main/bridge.ts';
  import type { Request, RequestWithoutId } from './shared/protocol.ts';
  import { initialUiState, reduce, controls, worldSnapshotNeeded, decisionBusy, currentDecision,
    decisionNotice, formatChecksum, formatTps, type UiEvent, type UiState } from './main/ui-state.ts';
  import { seedForStart, townConfig, DEFAULT_TOWN_SIZE, TOWN_SIZE_MIN, TOWN_SIZE_MAX } from './shared/seed.ts';
  import { isSpeed, SPEEDS, type Speed } from './shared/speeds.ts';
  import { transitionTemporaryPace, type TemporaryPace } from './main/temporary-pace.ts';
  import { LANDING_PREMISE, FAST_FORWARD_LABEL, FAST_FORWARD_HELP, paceLabel, runStateLabel,
    originLabel, nameLabel, transportText } from './main/player-copy.ts';
  import { dateLabel } from './main/calendar.ts';
  import type { PlayerOption, Slot } from './shared/world-snapshot.ts';
  import type { SceneClose } from './main/scene-queue.ts';
  import LifeSurface from './ui/LifeSurface.svelte';
  import OpeningIdentity from './ui/OpeningIdentity.svelte';
  import { loadLifeSprites, type SpriteSet } from './art/sprites.ts';
  import './ui/life.css';
  import { claimRequest, dreamRequest, parseBribeAmount, type UnderworldForm } from './main/customization.ts';
  import { feedbackView, identitySummary, underworldView } from './main/view-model.ts';
  import { DEFAULT_DECISION_WAIT_SECONDS } from './shared/decision.ts';
  import { exportNotebook } from './main/life-journal.ts';

  const { client, bridge }: { client: SimClient; bridge: EventBridge } = $props();
  let ui: UiState = $state(initialUiState());
  let seed = $state('');
  let townSize = $state(DEFAULT_TOWN_SIZE);
  let actualSeed = $state('');
  let actualConfig = $state('');
  let replay = $state('');
  let sprites: SpriteSet | null = $state(null);
  let assetError: string | null = $state(null);
  let fastForward: TemporaryPace | null = $state(null);
  let speedRequest: { worldId: number; id: number; pending: boolean } | null = $state(null);
  let runRequest: { worldId: number; id: number } | null = null;
  let recoveryBlocked: 'hold' | 'failed' | null = null;
  let presentationVersion = $state(0);
  const identity = $derived(identitySummary(ui));
  const buttons = $derived(controls(ui));
  const held = $derived(decisionBusy(ui));
  const notice = $derived(decisionNotice(ui));
  const paceBusy = $derived.by(() => {
    const request = speedRequest;
    const pace = fastForward;
    return request?.pending === true || pace !== null && pace.phase !== 'moving';
  });
  const feedback = $derived(feedbackView(ui));
  const openingBody = $derived(ui.world?.residents.find(person => person.id === ui.world?.player.body));
  const playerError = $derived(ui.error === null ? null : ui.errorKind === 'validation'
    ? ui.error : transportText(ui.errorKind ?? 'sim-error', ui.error, ui.errorOperation));

  function onClose(expected: SceneClose): void { dispatch({ type: 'scene-close', expected }); }
  function onSettled(expected: SceneClose): void { dispatch({ type: 'scene-settled', expected }); }
  function dispatch(event: UiEvent): void {
    const previousWorld = ui.worldId;
    const obsoleteSpeed = (event.type === 'reply' || event.type === 'request-failed') && event.request.type === 'set-speed'
      && (speedRequest?.worldId !== event.worldId || speedRequest?.id !== event.request.id);
    // Late ACKs still contribute their facts, but cannot undo a newer pace request.
    const olderSpeed = event.type === 'reply' && speedRequest !== null && speedRequest.worldId === event.worldId && event.request.id < speedRequest.id;
    const olderRunState = event.type === 'reply' && (event.request.type === 'run' || event.request.type === 'pause')
      && event.message.snapshot.runState !== 'failed' && runRequest !== null && runRequest.worldId === event.worldId && event.request.id < runRequest.id;
    if (event.type === 'reply' && (olderSpeed || olderRunState)) {
      event = { ...event, message: { ...event.message, snapshot: { ...event.message.snapshot,
        ...(olderSpeed ? { speed: ui.speed } : {}), ...(olderRunState ? { runState: ui.runState } : {}) } } };
    }
    ui = reduce(ui, event);
    if (ui.worldId !== previousWorld) {
      fastForward = null; speedRequest = null; runRequest = null; recoveryBlocked = null;
    }
    if (event.type === 'request-sent' && event.worldId === ui.worldId && fastForward?.worldId === ui.worldId
      && (event.request.type === 'set-speed' && ['starting', 'restoring', 'selecting'].includes(fastForward.phase)
        || event.request.type === 'pause' && fastForward.phase === 'stopping')) {
      fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
        { kind: 'request-sent', worldId: ui.worldId, requestId: event.request.id }).fastForward;
    }
    const snapshot = event.type === 'status' ? event.snapshot : event.type === 'reply' ? event.message.snapshot : null;
    const sameWorld = event.type === 'reply' ? event.worldId === ui.worldId && snapshot?.worldId === ui.worldId
      : event.type === 'status' ? snapshot?.worldId === ui.worldId : 'worldId' in event && event.worldId === ui.worldId;
    const failed = sameWorld && !obsoleteSpeed && (event.type === 'request-failed' && event.request.type !== 'create-world'
      || event.type === 'reply' && !event.message.ok && event.request.type !== 'create-world');
    if ((event.type === 'reply' || event.type === 'request-failed') && event.request.type === 'set-speed'
      && speedRequest !== null && speedRequest.worldId === event.worldId && speedRequest.id === event.request.id) speedRequest = { ...speedRequest, pending: false };
    if (ui.runState !== 'failed' && fastForward?.worldId === ui.worldId) {
      if (sameWorld && event.type === 'reply' && event.message.ok && !obsoleteSpeed
        && fastForward.requestId === event.request.id) {
        fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
          { kind: 'accepted', worldId: ui.worldId, requestId: event.request.id }).fastForward;
      }
      if (failed && fastForward !== null) {
        if (fastForward.phase === 'restoring' || fastForward.phase === 'stopping') {
          if ((event.type === 'reply' || event.type === 'request-failed') && fastForward.requestId === event.request.id) {
            fastForward = { ...fastForward, requestId: null };
            recoveryBlocked = event.type === 'reply' && !event.message.ok && event.message.kind === 'decision_pending' ? 'hold' : 'failed';
          }
        } else {
          fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
            { kind: 'error', worldId: ui.worldId }).fastForward;
        }
      } else if (snapshot?.worldId === ui.worldId && snapshot.stop !== undefined && fastForward !== null
        && ['starting', 'moving', 'selecting'].includes(fastForward.phase)) {
        fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
          { kind: 'stop', worldId: ui.worldId }).fastForward;
      }
      if (!failed && recoveryBlocked === 'hold' && !decisionBusy(ui)) recoveryBlocked = null;
      restorePace();
    }
    if (worldSnapshotNeeded(ui)) void sendRequest({ type: 'world-snapshot' });
  }
  function restorePace(): void {
    if (fastForward?.worldId !== ui.worldId || fastForward.requestId !== null || ui.createPending
      || decisionBusy(ui) || ui.runState === 'failed' || recoveryBlocked !== null) return;
    if (fastForward.phase === 'stopping') {
      if (ui.runState === 'running') { void sendRequest({ type: 'pause' }); return; }
      if (ui.runState !== 'paused') return;
      fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
        { kind: 'restore', worldId: ui.worldId }).fastForward;
    }
    if (fastForward?.phase === 'restoring') void sendRequest({ type: 'set-speed', speed: fastForward.previousSpeed });
  }

  async function sendRequest(input: RequestWithoutId): Promise<ReplyMessage | null> {
    const worldId = ui.worldId;
    const tick = ui.tick;
    let request: Request | undefined;
    try {
      const ticket = client.request(input);
      request = { ...input, id: ticket.requestId } as Request;
      if (input.type === 'set-speed') speedRequest = { worldId, id: ticket.requestId, pending: true };
      if (input.type === 'run' || input.type === 'pause') runRequest = { worldId, id: ticket.requestId };
      dispatch({ type: 'request-sent', request, worldId });
      const message = await ticket.reply;
      dispatch({ type: 'reply', request, worldId, message });
      return message;
    } catch (error) {
      if (request === undefined && fastForward?.worldId === worldId) {
        if (input.type === 'pause' && fastForward.phase === 'stopping'
          || input.type === 'set-speed' && fastForward.phase === 'restoring') recoveryBlocked = 'failed';
        else if (input.type === 'set-speed' && (fastForward.phase === 'starting' || fastForward.phase === 'selecting')) {
          fastForward = transitionTemporaryPace(fastForward, worldId, ui.speed as Speed,
            { kind: 'error', worldId }).fastForward;
        }
      }
      if (request !== undefined) dispatch({ type: 'request-failed', request, worldId, error: String(error) });
      else if (input.type === 'world-snapshot' && tick !== null) dispatch({ type: 'world-read-start-failed', worldId, tick, error: String(error) });
      else if (worldId === ui.worldId) dispatch({ type: 'validation-error', error: String(error) });
      return null;
    }
  }
  async function onChoose(worldId: number, node: string, option: PlayerOption): Promise<void> {
    const live = currentDecision(ui);
    if (ui.worldId !== worldId || live === null || live.id !== node || !live.options.some(entry => entry.id === option)) return;
    presentationVersion++;
    await sendRequest({ type: 'choose', node: live.id, option });
  }
  async function sendUnderworld(input: RequestWithoutId | null): Promise<void> {
    if (input === null || held || ui.createPending || ui.runState === 'failed' || ui.world?.player.place !== 'waiting') return;
    presentationVersion++;
    await sendRequest(input);
  }
  function onForm(form: UnderworldForm): void { dispatch({ type: 'underworld-form', form }); }
  async function onDream(): Promise<void> {
    if (ui.world === null || held || !underworldView(ui)?.dreamEnabled) return;
    await sendUnderworld(dreamRequest(ui.world, ui.underworldForm));
  }
  async function onClaim(slot: Slot): Promise<void> {
    if (!underworldView(ui)?.slots.some(entry => entry.slot === slot && entry.claimEnabled)) return;
    await sendUnderworld(claimRequest(ui.underworldForm, slot));
  }
  async function onBribe(worldId: number, amount: string): Promise<void> {
    if (worldId !== ui.worldId) return;
    const parsed = parseBribeAmount(amount);
    if (!parsed.ok) { dispatch({ type: 'validation-error', error: parsed.error }); return; }
    if (!ui.world?.underworld_view?.actions.bribe.availability.eligible) return;
    await sendUnderworld({ type: 'bribe', amount: parsed.value });
  }
  async function onHaunt(worldId: number, target: number): Promise<void> {
    if (worldId !== ui.worldId || !ui.world?.underworld_view?.actions.haunt.targets.some(entry => entry.target === target && entry.availability.eligible)) return;
    await sendUnderworld({ type: 'haunt', target });
  }
  async function onCreate(): Promise<void> {
    if (!controls(ui).create) return;
    const result = seedForStart(seed);
    if (!result.ok) { dispatch({ type: 'seed-invalid', problem: result.problem }); return; }
    if (!Number.isInteger(townSize) || townSize < TOWN_SIZE_MIN || townSize > TOWN_SIZE_MAX) {
      dispatch({ type: 'validation-error', error: `Town size must be a whole number from ${TOWN_SIZE_MIN} to ${TOWN_SIZE_MAX}.` });
      return;
    }
    const requestedSeed = result.value.toString();
    const requestedConfig = townConfig(townSize);
    const message = await sendRequest({ type: 'create-world', seed: requestedSeed, config: requestedConfig });
    if (message?.ok && message.snapshot.worldId === ui.worldId) {
      actualSeed = requestedSeed; actualConfig = requestedConfig; replay = '';
    }
  }
  async function onRun(): Promise<void> {
    if (!controls(ui).run || ui.createPending || paceBusy) return;
    presentationVersion++;
    await sendRequest({ type: 'run' });
  }
  async function onPause(): Promise<void> {
    if (!controls(ui).pause || ui.createPending || fastForward?.phase === 'stopping' && fastForward.requestId !== null) return;
    presentationVersion++;
    if (fastForward?.worldId === ui.worldId) {
      recoveryBlocked = null;
      fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
        { kind: 'pause', worldId: ui.worldId }).fastForward;
    }
    await sendRequest({ type: 'pause' });
  }
  async function onStep(): Promise<void> {
    if (!controls(ui).step || ui.createPending || paceBusy) return;
    presentationVersion++;
    await sendRequest({ type: 'step' });
  }
  async function onFastForward(): Promise<void> {
    if (!controls(ui).run || ui.createPending || held || fastForward !== null || paceBusy) return;
    const worldId = ui.worldId;
    const transition = transitionTemporaryPace(null, worldId, ui.speed as Speed, { kind: 'begin', worldId });
    fastForward = transition.fastForward;
    recoveryBlocked = null;
    presentationVersion++;
    const changed = await sendRequest({ type: 'set-speed', speed: transition.speed });
    if (!changed?.ok || ui.worldId !== worldId || speedRequest?.id !== changed.id
      || fastForward?.worldId !== worldId || fastForward.phase !== 'moving' || ui.runState === 'failed') return;
    if (controls(ui).run && !ui.createPending) await sendRequest({ type: 'run' });
    else {
      fastForward = transitionTemporaryPace(fastForward, worldId, ui.speed as Speed, { kind: 'stop', worldId }).fastForward;
      restorePace();
    }
  }
  async function onSpeedChange(event: Event): Promise<void> {
    const speed = Number((event.currentTarget as HTMLSelectElement).value);
    if (held || ui.createPending || ui.runState === 'failed' || fastForward !== null && fastForward.phase !== 'moving' || !isSpeed(speed)) return;
    fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
      { kind: 'select', worldId: ui.worldId, speed }).fastForward;
    await sendRequest({ type: 'set-speed', speed });
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
  async function onExport(): Promise<void> {
    const message = await sendRequest({ type: 'export-replay' });
    if (message?.ok && message.snapshot.worldId === ui.worldId) replay = message.replay ?? '';
  }
  function onExportFacts(): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportNotebook(ui.notebook), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `life-facts-world-${ui.worldId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  $effect(() => {
    let mounted = true;
    void loadLifeSprites().then(loaded => { if (mounted) sprites = loaded; }, error => { if (mounted) assetError = String(error); });
    return () => { mounted = false; };
  });
  $effect(() => {
    bridge.dispatch = dispatch;
    void untrack(() => sendRequest({ type: 'decision-status' }));
    return () => { bridge.dispatch = null; };
  });
</script>

<main data-testid="life-app" data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header class="life-header" data-testid="life-header">
    <div class="header-identity">
      <h1>Back in the Family</h1>
      {#if identity !== null}
        <strong class="body-name" data-testid="life-name">{nameLabel(identity.name)}</strong>
        <p>{identity.status === 'waiting' ? 'Between lives' : 'Your life'}{#if identity.age !== null} · {identity.age} years old{/if}
          {#if identity.origin !== null} · {originLabel(identity.origin)}{/if}</p>
      {/if}
    </div>
    {#if ui.world !== null}
      <div class="header-actions">
        <p class="clock"><time data-testid="game-date">{dateLabel(ui.tick ?? ui.world.tick)}</time> · <span data-testid="run-state">{runStateLabel(ui.runState)}</span></p>
        <section class="controls" aria-label="Life pace">
          <button type="button" data-testid="run" disabled={!buttons.run || ui.createPending || paceBusy} onclick={onRun}>Play</button>
          <button type="button" data-testid="pause" disabled={!buttons.pause || ui.createPending || fastForward?.phase === 'stopping' && fastForward.requestId !== null} onclick={onPause}>Pause</button>
          <button type="button" data-testid="step" disabled={!buttons.step || ui.createPending || paceBusy} onclick={onStep}>One day</button>
          <label>Pace <select data-testid="speed" disabled={held || ui.createPending || fastForward !== null && fastForward.phase !== 'moving'} value={ui.speed} onchange={onSpeedChange}>
            {#each SPEEDS as speed (speed)}<option value={speed}>{paceLabel(speed)}</option>{/each}
          </select></label>
        </section>
        <button type="button" class="fast-forward" data-testid="fast-forward" title={FAST_FORWARD_HELP} disabled={!buttons.run || ui.createPending || held || fastForward !== null || paceBusy} onclick={onFastForward}>
          {fastForward !== null ? 'Moving ahead…' : FAST_FORWARD_LABEL}
        </button>
      </div>
    {/if}
  </header>
  {#if ui.world === null}
    <section id="current-action" class="landing">
      <div class="landing-book" aria-hidden="true"><span>One town.<br />More than one lifetime.</span></div>
      <div class="landing-copy">
        <h2>A life is waiting for you.</h2>
        <p>{LANDING_PREMISE}</p>
        <button type="button" class="start" data-testid="create" disabled={!buttons.create} onclick={onCreate}>Start</button>
        <details data-testid="world-setup"><summary>Advanced</summary>
          <label>Seed <input data-testid="seed" type="text" inputmode="numeric" bind:value={seed} placeholder="Leave blank for a new town" /></label>
          <label>Town size <input data-testid="town-size" type="number" min={TOWN_SIZE_MIN} max={TOWN_SIZE_MAX} bind:value={townSize} /></label>
        </details>
      </div>
    </section>
  {:else}
    {#if ui.tick === '0' && ui.runState === 'paused' && openingBody !== undefined}
      <OpeningIdentity world={ui.world} actors={ui.notebook.actors} />
    {/if}
    <section class="decision-status" aria-label="Processing a request" data-testid="decision-controls">
      <p role="status" data-testid="decision-notice" data-outcome={held ? 'pending' : ui.decision?.outcome?.kind ?? ''}>{held ? 'Your request is being considered. The calendar is on hold.' : notice ?? ''}</p>
      {#if ui.decision?.pending?.worldId === ui.worldId}<button type="button" data-testid="use-rules-now" onclick={onUseRules}>Use the default answer now</button>{/if}
    </section>
    <LifeSurface {ui} {sprites} {feedback} {presentationVersion} {onChoose} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} {onClose} {onSettled} />
    <details class="restart" data-testid="world-setup"><summary>Start a new game</summary>
      <p>A new town starts a new game. Rebirth applications continue this one.</p>
      <label>Seed <input data-testid="seed" type="text" inputmode="numeric" bind:value={seed} placeholder="Leave blank for a new town" /></label>
      <label>Town size <input data-testid="town-size" type="number" min={TOWN_SIZE_MIN} max={TOWN_SIZE_MAX} bind:value={townSize} /></label>
      <button type="button" data-testid="create" disabled={!buttons.create} onclick={onCreate}>Start a new game</button>
    </details>
  {/if}
  {#if ui.seedMessage !== null}<p role="alert" class="error" data-testid="seed-message">{ui.seedMessage}</p>{/if}
  {#if assetError !== null}<p role="alert" data-testid="art-error">The illustration could not be opened. Your words and actions are still available.</p>
  {:else if sprites === null}<p role="status" data-testid="art-loading">Opening the picture book…</p>{/if}
  {#if playerError !== null}<p role="alert" class="error" data-testid="error">{playerError}</p>{/if}
  <details class="technical" data-testid="technical-details">
    <summary>Technical details</summary>
    <p>Seed: {actualSeed || 'Not started'} · World generation: {ui.worldId}</p>
    <pre data-testid="config">{actualConfig}</pre>
    <p>Tick: <span data-testid="tick">{ui.tick ?? '—'}</span> · Soul: <span data-testid="life-soul">{ui.world?.player_soul ?? '—'}</span></p>
    <p>Run state: <span data-testid="technical-run-state">{ui.runState}</span></p>
    <p>Checksum <span data-testid="checksum">{formatChecksum(ui)}</span> · Ticks per second <span data-testid="tps">{formatTps(ui)}</span></p>
    <label>Decision wait (seconds)<select data-testid="decision-wait" value={ui.decision?.waitSeconds ?? DEFAULT_DECISION_WAIT_SECONDS} onchange={onWaitChange}>
      {#each Array.from({ length: 11 }, (_, seconds) => seconds) as seconds (seconds)}<option value={seconds}>{seconds === 0 ? '0 — default immediately' : seconds}</option>{/each}
    </select></label>
    {#if ui.decision !== null}<p data-testid="decision-diagnostics">Config: {ui.decision.config} · enabled: {ui.decision.enabled} · Requests: {ui.decision.spent}/{ui.decision.sessionCap ?? '—'}</p>{/if}
    {#if ui.error !== null}<pre>{ui.error}</pre>{/if}{#if assetError !== null}<pre>{assetError}</pre>{/if}
    <button type="button" onclick={onExport} disabled={ui.world === null}>Export replay</button>
    {#if replay}<pre class="replay">{replay}</pre>{/if}
    <details><summary>Unmerged life facts</summary>
      <p>{ui.notebook.identities.length} records; all current-world actors and records retained.</p>
      <button type="button" onclick={onExportFacts} disabled={ui.world === null}>Download life facts</button>
    </details>
  </details>
</main>

<style>
  main { max-width: 1280px; margin: 0 auto; padding: 20px 24px 48px; }
  .life-header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--life-border); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  .body-name { display: block; font-size: 26px; line-height: 1.2; }
  .header-identity p, .clock { margin: 6px 0; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .controls label { display: flex; align-items: center; gap: 8px; }
  .header-actions { min-width: 0; }
  .clock { font-variant-numeric: tabular-nums; }
  .fast-forward { margin-top: 8px; }
  .landing { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; align-items: center; min-height: 60vh; }
  .landing-book { display: flex; align-items: end; min-height: 320px; padding: 32px; border: 2px solid var(--life-border); background: var(--life-secondary); }
  .landing-book span { font-size: clamp(30px, 4vw, 52px); line-height: 1.1; font-weight: 700; }
  .landing-copy h2 { font-size: 32px; }
  .landing-copy p { max-width: 52ch; }
  .start { min-width: 140px; margin: 16px 0; }
  .decision-status { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .decision-status p:empty { display: none; }
  .technical, .restart { margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--life-border); }
  details label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
  pre { max-width: 100%; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .replay { max-height: 24rem; }
  .error { color: var(--life-event); }
  @media (max-width: 1100px) { .life-header { display: block; } .header-actions { margin-top: 16px; } }
  @media (max-width: 700px) { main { padding: 16px; } .landing { grid-template-columns: 1fr; gap: 20px; } .landing-book { min-height: 160px; padding: 24px; } }
</style>
