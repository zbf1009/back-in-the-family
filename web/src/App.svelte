<script lang="ts">
  import { untrack } from 'svelte';
  import type { SimClient, ReplyMessage } from './main/sim-client.ts';
  import type { EventBridge } from './main/bridge.ts';
  import type { PauseReason, Request, RequestWithoutId } from './shared/protocol.ts';
  import { initialUiState, reduce, controls, worldSnapshotNeeded, decisionBusy, currentDecision,
    formatChecksum, formatTps, type UiEvent, type UiState } from './main/ui-state.ts';
  import { seedForStart, townConfig, DEFAULT_TOWN_SIZE, TOWN_SIZE_MIN, TOWN_SIZE_MAX } from './shared/seed.ts';
  import { isSpeed, SPEEDS, type Speed } from './shared/speeds.ts';
  import { transitionTemporaryPace, type TemporaryPace } from './main/temporary-pace.ts';
  import { FAST_FORWARD_LABEL, FAST_FORWARD_HELP, PACE_LABELS, paceLabel, runStateLabel,
    pauseReasonLabel, nameLabel, transportText } from './main/player-copy.ts';
  import { TECHNICAL_TEXT, supportedText } from './main/technical-text.ts';
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
  import { entryContext, exportNotebook } from './main/life-journal.ts';
  import { ObituaryRun } from './main/obituary-store.ts';
  import { buildObituaryFacts } from './main/obituary-facts.ts';
  import { fetchObituaryCapability, startObituaryAttempt, type ObituaryCapabilityState } from './main/obituary-client.ts';
  import { exportObituarySidecar } from './main/obituary-export.ts';
  import { downloadJsonBytes } from './main/download-json.ts';

  const { client, bridge }: { client: SimClient; bridge: EventBridge } = $props();
  let ui: UiState = $state(initialUiState());
  let seed = $state('');
  let townSize = $state(DEFAULT_TOWN_SIZE);
  let validationInput: 'town-size' | null = $state(null);
  let actualSeed = $state('');
  let actualConfig = $state('');
  let replay = $state('');
  let sprites: SpriteSet | null = $state(null);
  let assetError: string | null = $state(null);
  let fastForward: TemporaryPace | null = $state(null);
  let speedRequest: { worldId: number; id: number; pending: boolean } | null = $state(null);
  let runRequest: { worldId: number; id: number; type: 'run' | 'pause'; pending: boolean } | null = $state(null);
  let pendingRunRequest: { worldId: number; id: number } | null = $state(null);
  let executedRun: { worldId: number; id: number } | null = null;
  let stoppedRun: { worldId: number; id: number } | null = null;
  let recoveryBlocked: 'hold' | 'failed' | 'manual' | null = $state(null);
  let stopReasons: PauseReason[] = $state([]);
  let presentationVersion = $state(0);
  let obituaryRun: ObituaryRun | null = $state.raw(null);
  let obituaryRevision = $state(0);
  let obituaryError: string | null = $state(null);
  let obituaryCapability: ObituaryCapabilityState = { capability: null, reason: 'capability_unavailable' };
  const obituaries = $derived.by(() => { obituaryRevision; return obituaryRun?.visible() ?? []; });
  const obituaryEntries = $derived.by(() => { obituaryRevision; return obituaryRun?.entries() ?? []; });
  const obituaryPending = $derived(obituaryEntries.some(entry => entry.attempt === 'pending'));
  const identity = $derived(identitySummary(ui));
  const buttons = $derived(controls(ui));
  const held = $derived(decisionBusy(ui));
  const bureauThinking = $derived.by(() => held && ui.actions.some(action => action.worldId === ui.worldId
    && (action.request?.type === 'dream' || action.request?.type === 'bribe')
    && (action.phase === 'sending' || action.phase === 'deciding')
    && (action.requestId === ui.decisionSendingRequestId || action.requestId === ui.decision?.pending?.requestId)));
  const pendingRun = $derived.by(() => pendingRunRequest?.worldId === ui.worldId);
  const paceBusy = $derived.by(() => {
    const request = speedRequest;
    const pace = fastForward;
    return request?.pending === true || pace !== null && pace.phase !== 'moving';
  });
  const skipAheadEnabled = $derived.by(() => (buttons.run || ui.runState === 'running' && buttons.pause)
    && !ui.createPending && !held && fastForward === null && !paceBusy && !pendingRun && runRequest?.pending !== true);
  const recoveryPending = $derived.by(() => fastForward !== null && fastForward.requestId !== null
    || speedRequest?.pending === true || runRequest?.pending === true);
  const feedback = $derived(feedbackView(ui));
  const openingBody = $derived(ui.world?.residents.find(person => person.id === ui.world?.player.body));
  const playerError = $derived(ui.error === null ? null : ui.errorKind === 'validation'
    ? ui.error : transportText(ui.errorKind ?? 'sim-error', ui.runState, ui.error, ui.errorOperation));

  function onClose(expected: SceneClose): void { dispatch({ type: 'scene-close', expected }); }
  function onSettled(expected: SceneClose): void { dispatch({ type: 'scene-settled', expected }); }
  function dispatch(event: UiEvent): void {
    const previousUi = ui;
    const previousWorld = ui.worldId;
    const previousTick = ui.tick;
    const obsoleteSpeed = (event.type === 'reply' || event.type === 'request-failed') && event.request.type === 'set-speed'
      && (speedRequest?.worldId !== event.worldId || speedRequest?.id !== event.request.id);
    // Late ACKs still contribute their facts, but cannot undo a newer pace request.
    const olderSpeed = event.type === 'reply' && speedRequest !== null && speedRequest.worldId === event.worldId && event.request.id < speedRequest.id;
    const olderRunState = event.type === 'reply' && event.message.snapshot.runState !== 'failed'
      && (runRequest !== null && runRequest.worldId === event.worldId && event.request.id < runRequest.id
        && (event.request.type === 'run' || event.request.type === 'pause' || runRequest.type === 'pause' && !runRequest.pending)
        || stoppedRun !== null && stoppedRun.worldId === event.worldId && event.request.id <= stoppedRun.id);
    const pausedSpeed = event.type === 'reply' && event.request.type === 'set-speed'
      && event.message.snapshot.runState !== 'failed' && fastForward !== null && fastForward.worldId === event.worldId && fastForward.paused;
    if (event.type === 'reply' && (olderSpeed || olderRunState || pausedSpeed)) {
      event = { ...event, message: { ...event.message, snapshot: { ...event.message.snapshot,
        ...(olderSpeed ? { speed: ui.speed } : {}), ...(olderRunState || olderSpeed && event.request.type !== 'run' && event.message.snapshot.runState !== 'failed' ? { runState: ui.runState }
          : pausedSpeed ? { runState: 'paused' as const } : {}) } } };
    }
    ui = reduce(ui, event);
    if (ui.worldId !== previousWorld) {
      fastForward = null; speedRequest = null; runRequest = null; pendingRunRequest = null; executedRun = null; stoppedRun = null; recoveryBlocked = null; stopReasons = [];
      obituaryRun = new ObituaryRun(ui.worldId); obituaryRevision++; obituaryError = null;
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
    if (sameWorld && event.type === 'reply' && event.message.ok && event.request.type === 'run'
      && (executedRun === null || event.request.id > executedRun.id)) executedRun = { worldId: ui.worldId, id: event.request.id };
    const confirmedPause = sameWorld && ui.runState === 'paused'
      && (event.type === 'status' && snapshot?.stop !== undefined
        || event.type === 'reply' && event.message.ok && (event.request.type === 'pause' || snapshot?.stop !== undefined));
    if (confirmedPause) {
      // A Pause ACK orders all earlier controls; a natural stop only identifies an acknowledged Run.
      const id = event.type === 'reply' && event.request.type === 'pause' ? event.request.id
        : executedRun?.worldId === ui.worldId ? executedRun.id : null;
      if (id !== null && (stoppedRun === null || id > stoppedRun.id)) stoppedRun = { worldId: ui.worldId, id };
    }
    const currentStopFrame = sameWorld && ui.runState !== 'failed' && !olderSpeed && !olderRunState && !pausedSpeed
      && (event.type === 'status' || event.type === 'reply' && event.message.ok)
      && (previousTick === null || snapshot?.tick !== null && snapshot?.tick !== undefined && BigInt(snapshot.tick) >= BigInt(previousTick));
    if (currentStopFrame) {
      if (ui.runState === 'running') stopReasons = [];
      else if (confirmedPause && snapshot?.stop !== undefined) stopReasons = snapshot.stop.reasons;
    }
    const failed = sameWorld && !obsoleteSpeed && (event.type === 'request-failed' && event.request.type !== 'create-world'
      || event.type === 'reply' && !event.message.ok && event.request.type !== 'create-world');
    if ((event.type === 'reply' || event.type === 'request-failed') && event.request.type === 'set-speed'
      && speedRequest !== null && speedRequest.worldId === event.worldId && speedRequest.id === event.request.id) speedRequest = { ...speedRequest, pending: false };
    if ((event.type === 'reply' || event.type === 'request-failed') && runRequest !== null
      && runRequest.worldId === event.worldId && runRequest.id === event.request.id) runRequest = { ...runRequest, pending: false };
    if ((event.type === 'reply' || event.type === 'request-failed') && pendingRunRequest !== null
      && pendingRunRequest.worldId === event.worldId && pendingRunRequest.id === event.request.id) pendingRunRequest = null;
    if (ui.runState !== 'failed' && fastForward?.worldId === ui.worldId) {
      if (confirmedPause && fastForward.phase === 'selecting') fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
        { kind: 'paused', worldId: ui.worldId }).fastForward;
      if (sameWorld && event.type === 'reply' && event.message.ok && !obsoleteSpeed
        && fastForward !== null && fastForward.requestId === event.request.id) {
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
          const failedControl = (event.type === 'reply' || event.type === 'request-failed') && (event.request.type === 'set-speed' || event.request.type === 'pause');
          fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
            { kind: 'error', worldId: ui.worldId }).fastForward;
          if (failedControl) recoveryBlocked = event.type === 'reply' && !event.message.ok && event.message.kind === 'decision_pending' ? 'hold' : 'failed';
        }
      } else if (snapshot?.worldId === ui.worldId && snapshot.stop !== undefined && fastForward !== null
        && ['starting', 'moving', 'selecting'].includes(fastForward.phase)) {
        fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
          { kind: 'stop', worldId: ui.worldId }).fastForward;
      }
      if (!failed && recoveryBlocked === 'hold' && !decisionBusy(ui)) recoveryBlocked = null;
      restorePace();
    }
    syncObituaries(previousUi, event);
    if (worldSnapshotNeeded(ui)) void sendRequest({ type: 'world-snapshot' });
  }
  function syncObituaries(previous: UiState, event: UiEvent): void {
    const run = obituaryRun;
    if (run === null || run.worldId !== ui.worldId) return;
    const changed = () => { if (obituaryRun === run && ui.worldId === run.worldId) obituaryRevision++; };
    if (ui.playerLifecycle !== previous.playerLifecycle || ui.notebook.ownDeathSummaries !== previous.notebook.ownDeathSummaries) {
      for (const death of ui.playerLifecycle) {
        if (death.kind !== 'death' || run.hasDeath(death.event)) continue;
        const summary = ui.notebook.ownDeathSummaries.get(death.event);
        const context = entryContext(ui.notebook, `e:${death.event}`);
        try {
          if (summary === undefined || summary.body !== death.body || summary.tick !== death.tick
            || context?.phase.kind !== 'life' || context.phase.person !== death.body) {
            throw new Error('Own-death obituary observation has no complete matching summary and life context.');
          }
          const facts = buildObituaryFacts(ui.notebook, death, summary);
          const entry = run.admit({ eventId: death.event, personId: death.body, tick: death.tick, lifeKey: context.phase.key }, facts);
          if (entry !== null) {
            obituaryError = null; changed();
            void startObituaryAttempt(run, entry, obituaryCapability, changed).catch(error => {
              if (obituaryRun === run) obituaryError = String(error);
            });
          }
        } catch (error) { obituaryError = String(error); }
      }
    }
    if (event.type === 'scene-settled' && ui.settledScene?.entry === event.expected.entry) {
      const death = event.expected.entry.keyScene?.lifecycle;
      if (death?.kind === 'death' && run.markReady(death.event)) changed();
    }
    if (previous.worldId === ui.worldId && ui.runState !== 'failed' && previous.scene !== ui.scene) {
      for (const entry of previous.scene?.entries ?? []) {
        const death = entry.keyScene?.lifecycle;
        if (death?.kind === 'death' && !ui.scene?.entries.includes(entry) && run.markReady(death.event)) changed();
      }
    }
  }
  function restorePace(): void {
    if (fastForward?.worldId !== ui.worldId || fastForward.requestId !== null || ui.createPending
      || decisionBusy(ui) || ui.runState === 'failed' || recoveryBlocked === 'failed' || recoveryBlocked === 'hold') return;
    if (fastForward.phase === 'stopping') {
      if (ui.runState === 'running') { void sendRequest({ type: 'pause' }); return; }
      if (ui.runState !== 'paused') return;
      fastForward = transitionTemporaryPace(fastForward, ui.worldId, ui.speed as Speed,
        { kind: 'restore', worldId: ui.worldId }).fastForward;
    }
    if (fastForward?.phase === 'restoring') void sendRequest({ type: 'set-speed', speed: fastForward.targetSpeed });
  }
  function onRestorePace(): void {
    if (fastForward?.worldId !== ui.worldId || recoveryBlocked !== 'failed' || recoveryPending
      || decisionBusy(ui) || ui.createPending || ui.runState === 'failed') return;
    recoveryBlocked = 'manual';
    restorePace();
  }

  async function sendRequest(input: RequestWithoutId): Promise<ReplyMessage | null> {
    if (input.type === 'run' && pendingRun) return null;
    const worldId = ui.worldId;
    const tick = ui.tick;
    let request: Request | undefined;
    try {
      const ticket = client.request(input);
      request = { ...input, id: ticket.requestId } as Request;
      if (input.type === 'set-speed') speedRequest = { worldId, id: ticket.requestId, pending: true };
      if (input.type === 'run' || input.type === 'pause') runRequest = { worldId, id: ticket.requestId, type: input.type, pending: true };
      if (input.type === 'run') pendingRunRequest = { worldId, id: ticket.requestId };
      dispatch({ type: 'request-sent', request, worldId });
      const message = await ticket.reply;
      dispatch({ type: 'reply', request, worldId, message });
      return message;
    } catch (error) {
      if (request === undefined && fastForward?.worldId === worldId && worldId === ui.worldId && ui.runState !== 'failed') {
        if (input.type === 'set-speed' && (fastForward.phase === 'starting' || fastForward.phase === 'selecting')) {
          fastForward = transitionTemporaryPace(fastForward, worldId, ui.speed as Speed,
            { kind: 'error', worldId }).fastForward;
        }
        if (input.type === 'pause' || input.type === 'set-speed') recoveryBlocked = 'failed';
      }
      if (request !== undefined) dispatch({ type: 'request-failed', request, worldId, error: String(error) });
      else if (input.type === 'world-snapshot' && tick !== null) dispatch({ type: 'world-read-start-failed', worldId, tick, error: String(error) });
      else if (worldId === ui.worldId) dispatch({ type: 'request-start-failed', worldId, operation: input.type, error: String(error) });
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
    validationInput = null;
    const result = seedForStart(seed);
    if (!result.ok) { dispatch({ type: 'seed-invalid', problem: result.problem }); return; }
    if (!Number.isInteger(townSize) || townSize < TOWN_SIZE_MIN || townSize > TOWN_SIZE_MAX) {
      validationInput = 'town-size';
      dispatch({ type: 'validation-error', error: supportedText(TECHNICAL_TEXT.townSizeError,
        { min: String(TOWN_SIZE_MIN), max: String(TOWN_SIZE_MAX) })! });
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
    if (!controls(ui).run || ui.createPending || paceBusy || pendingRun) return;
    presentationVersion++;
    await sendRequest({ type: 'run' });
  }
  async function onPause(): Promise<void> {
    if (!controls(ui).pause || ui.createPending || runRequest?.type === 'pause' && runRequest.pending || fastForward?.phase === 'stopping' && fastForward.requestId !== null) return;
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
    if (!skipAheadEnabled) return;
    const worldId = ui.worldId;
    const wasRunning = ui.runState === 'running';
    const transition = transitionTemporaryPace(null, worldId, ui.speed as Speed, { kind: 'begin', worldId });
    fastForward = transition.fastForward;
    recoveryBlocked = null;
    presentationVersion++;
    const changed = await sendRequest({ type: 'set-speed', speed: transition.speed });
    if (!changed?.ok || ui.worldId !== worldId || speedRequest?.id !== changed.id
      || fastForward?.worldId !== worldId || fastForward.phase !== 'moving' || ui.runState === 'failed') return;
    if (ui.runState === 'running') return;
    if (!wasRunning && controls(ui).run && !ui.createPending && !pendingRun && runRequest?.pending !== true) await sendRequest({ type: 'run' });
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
    if (message?.ok && message.snapshot.worldId === ui.worldId && message.replay !== undefined) {
      replay = message.replay;
      downloadJsonBytes(`world-${ui.worldId}.replay.json`, replay);
    }
  }
  async function onExportObituaries(): Promise<void> {
    const run = obituaryRun;
    if (run === null || run.worldId !== ui.worldId) return;
    const message = await sendRequest({ type: 'export-replay' });
    if (!message?.ok || message.replay === undefined || message.snapshot.worldId !== run.worldId || obituaryRun !== run) return;
    replay = message.replay;
    try {
      const sidecar = await exportObituarySidecar(run, message.replay);
      if (obituaryRun !== run) return;
      downloadJsonBytes(`world-${run.worldId}.obituaries.json`, JSON.stringify(sidecar, null, 2));
      obituaryError = null;
    } catch (error) { if (obituaryRun === run) obituaryError = String(error); }
  }
  function onExportFacts(): void {
    downloadJsonBytes(`life-facts-world-${ui.worldId}.json`, JSON.stringify(exportNotebook(ui.notebook), null, 2));
  }
  $effect(() => {
    let mounted = true;
    void loadLifeSprites().then(loaded => { if (mounted) sprites = loaded; }, error => { if (mounted) assetError = String(error); });
    return () => { mounted = false; };
  });
  $effect(() => {
    bridge.dispatch = dispatch;
    let mounted = true;
    void fetchObituaryCapability().then(capability => { if (mounted) obituaryCapability = capability; });
    void untrack(() => sendRequest({ type: 'decision-status' }));
    return () => { mounted = false; bridge.dispatch = null; };
  });
</script>

<main data-testid="life-app" data-world-id={ui.worldId} data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header class="life-header" data-testid="life-header">
    <div class="header-identity">
      <h1>{TECHNICAL_TEXT.title}</h1>
      {#if identity !== null}
        <strong class="body-name" data-testid="life-name">{nameLabel(identity.name)}</strong>
        {#if identity.status === 'waiting' || identity.age !== null}
          <p>{identity.status === 'waiting' ? TECHNICAL_TEXT.waiting : identity.age} · <time data-testid="game-date">{dateLabel(ui.tick ?? ui.world!.tick)}</time></p>
        {/if}
      {/if}
    </div>
    {#if ui.world !== null}
      <div class="header-actions">
        <p class="clock"><span data-testid="run-state">{runStateLabel(ui.runState)}</span>{#each stopReasons as reason (reason)} · {pauseReasonLabel(reason)}{/each}</p>
        <section class="controls" aria-label={TECHNICAL_TEXT.pace}>
          <button type="button" data-testid="run" disabled={!buttons.run || ui.createPending || paceBusy || pendingRun} onclick={onRun}>{TECHNICAL_TEXT.play}</button>
          <button type="button" data-testid="pause" disabled={!buttons.pause || ui.createPending || runRequest?.type === 'pause' && runRequest.pending || fastForward?.phase === 'stopping' && fastForward.requestId !== null} onclick={onPause}>{TECHNICAL_TEXT.pause}</button>
          <button type="button" data-testid="step" disabled={!buttons.step || ui.createPending || paceBusy} onclick={onStep}>{TECHNICAL_TEXT.oneDay}</button>
          <label>{TECHNICAL_TEXT.pace} <select data-testid="speed" disabled={held || ui.createPending || ui.runState === 'failed' || fastForward !== null && fastForward.phase !== 'moving'} value={ui.speed} onchange={onSpeedChange}>
            {#each SPEEDS as speed (speed)}<option value={speed}>{paceLabel(speed)}</option>{/each}
          </select></label>
        </section>
        <button type="button" class="fast-forward" data-testid="fast-forward" title={FAST_FORWARD_HELP} disabled={!skipAheadEnabled} onclick={onFastForward}>
          {fastForward !== null ? TECHNICAL_TEXT.skippingAhead : FAST_FORWARD_LABEL}
        </button>
        {#if fastForward?.worldId === ui.worldId && (recoveryBlocked === 'failed' || recoveryBlocked === 'manual') && ui.runState !== 'failed'}
          <p role="status" data-testid="pace-recovery-notice">{supportedText(ui.runState === 'running'
            ? TECHNICAL_TEXT.paceRecoveryRunningStatus : TECHNICAL_TEXT.paceRecoveryPausedStatus,
            { pace: PACE_LABELS[fastForward.targetSpeed] })}</p>
          <button type="button" data-testid="restore-pace" disabled={recoveryPending || held || ui.createPending} onclick={onRestorePace}>{supportedText(TECHNICAL_TEXT.paceRecovery, { pace: PACE_LABELS[fastForward.targetSpeed] })}</button>
        {/if}
      </div>
    {/if}
  </header>
  {#if ui.world === null}
    <section id="current-action" class="landing">
      <div class="landing-book"><span>{TECHNICAL_TEXT.tagline}</span></div>
      <div class="landing-copy">
        <p>{TECHNICAL_TEXT.premise}</p>
        <button type="button" class="start" data-testid="create" disabled={!buttons.create} onclick={onCreate}>{TECHNICAL_TEXT.start}</button>
        <details data-testid="world-setup"><summary>Advanced</summary>
          <label>{TECHNICAL_TEXT.seed} <input data-testid="seed" type="text" inputmode="numeric" bind:value={seed} placeholder={TECHNICAL_TEXT.seedHint} /></label>
          <label>{TECHNICAL_TEXT.townSize} <input data-testid="town-size" type="number" min={TOWN_SIZE_MIN} max={TOWN_SIZE_MAX} aria-invalid={ui.errorKind === 'validation' && validationInput === 'town-size'} aria-describedby={ui.errorKind === 'validation' && validationInput === 'town-size' ? 'local-validation-error' : undefined} bind:value={townSize} /></label>
        </details>
      </div>
    </section>
  {:else}
    {#if ui.tick === '0' && ui.runState === 'paused' && openingBody !== undefined}
      <OpeningIdentity world={ui.world} actors={ui.notebook.actors} {sprites} />
    {/if}
    {#if bureauThinking || ui.decision?.pending?.worldId === ui.worldId}
      <section class="decision-status" aria-label={TECHNICAL_TEXT.desk} data-testid="decision-controls">
        {#if bureauThinking}<p role="status" data-testid="decision-notice" data-outcome="pending">{TECHNICAL_TEXT.bureauThinking}</p>{/if}
        {#if ui.decision?.pending?.worldId === ui.worldId}<button type="button" data-testid="use-rules-now" onclick={onUseRules}>{TECHNICAL_TEXT.usual}</button>{/if}
      </section>
    {/if}
    <LifeSurface {ui} {sprites} {feedback} {obituaries} {presentationVersion} {onChoose} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} {onClose} {onSettled} />
    <details class="restart" data-testid="world-setup"><summary>{TECHNICAL_TEXT.restart}</summary>
      <label>{TECHNICAL_TEXT.seed} <input data-testid="seed" type="text" inputmode="numeric" bind:value={seed} placeholder={TECHNICAL_TEXT.seedHint} /></label>
      <label>{TECHNICAL_TEXT.townSize} <input data-testid="town-size" type="number" min={TOWN_SIZE_MIN} max={TOWN_SIZE_MAX} aria-invalid={ui.errorKind === 'validation' && validationInput === 'town-size'} aria-describedby={ui.errorKind === 'validation' && validationInput === 'town-size' ? 'local-validation-error' : undefined} bind:value={townSize} /></label>
      <button type="button" data-testid="create" disabled={!buttons.create} onclick={onCreate}>{TECHNICAL_TEXT.restart}</button>
    </details>
  {/if}
  {#if ui.seedMessage !== null}<p role="alert" class="error" data-testid="seed-message" data-validation-category="seed">{ui.seedMessage}</p>{/if}
  {#if assetError !== null}<p role="alert" data-testid="art-error">{TECHNICAL_TEXT.picturesFailed}</p>
  {:else if sprites === null}<p role="status" data-testid="art-loading">{TECHNICAL_TEXT.picturesLoading}</p>{/if}
  {#if playerError !== null}<p role="alert" class="error" data-testid="error" id="local-validation-error" data-error-kind={ui.errorKind} data-validation-category={ui.errorKind === 'validation' ? validationInput ?? 'local' : undefined}>{playerError}</p>{/if}
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
    {#if ui.decision !== null}<p data-testid="decision-diagnostics">Config: {ui.decision.config} · enabled: {ui.decision.enabled} · Requests: {ui.decision.spent}/{ui.decision.sessionCap ?? '—'}</p>
      <pre data-testid="decision-state">{JSON.stringify({ pending: ui.decision.pending, outcome: ui.decision.outcome }, null, 2)}</pre>{/if}
    {#if ui.error !== null}<pre>{ui.error}</pre>{/if}{#if assetError !== null}<pre>{assetError}</pre>{/if}
    <button type="button" onclick={onExport} disabled={ui.world === null}>Export replay</button>
    <button type="button" onclick={onExportObituaries} disabled={ui.world === null || ui.runState === 'failed' || obituaryRun === null || obituaryPending || obituaryError !== null}>{TECHNICAL_TEXT.obituaryExport}</button>
    {#if obituaryEntries.length > 0}<pre data-testid="obituary-records">{JSON.stringify(obituaryEntries.map(entry => ({ runId: entry.runId, death: entry.death, operationKey: entry.operationKey, facts: entry.facts, attempt: entry.attempt, result: entry.result, ready: entry.ready })), null, 2)}</pre>{/if}
    {#if obituaryError !== null}<pre data-testid="obituary-error">{obituaryError}</pre>{/if}
    {#if replay}<pre class="replay">{replay}</pre>{/if}
    <details><summary>Unmerged life facts</summary>
      <p>{ui.notebook.identities.length} records; all current-world actors and records retained.</p>
      <button type="button" onclick={onExportFacts} disabled={ui.world === null}>Download life facts</button>
    </details>
  </details>
  <footer><a href="/credits.html">{TECHNICAL_TEXT.credits}</a></footer>
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
