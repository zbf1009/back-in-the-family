<script lang="ts">
  import type { OperationState } from '../shared/operation-state.ts';
  import type { StoryActor } from '../shared/story.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { OPERATION_LABELS, OPERATION_PHASE_LABELS, dreamIntentLabel, dreamResponseLabel, nameLabel, refusalText, rulingLabel, sourceLabel, RULING_ACCESS_NOTE } from '../main/player-copy.ts';
  const { state, actors = {} }: { state: OperationState; actors?: Readonly<Record<number, StoryActor>> } = $props();
</script>

<article class="receipt" class:refused={state.phase === 'refused'} aria-label={`${OPERATION_LABELS[state.kind]} receipt`}
  data-testid="operation-receipt" data-kind={state.kind} data-phase={state.phase} data-world={state.worldId} data-request={state.requestId} data-inputs={state.inputSeqs.join(',')}>
  <header><strong>{OPERATION_LABELS[state.kind]}</strong>
    <span class="stamp">{state.phase === 'refused' ? state.refusalStage === 'processing' ? 'Processing declined' : 'Filing declined' : OPERATION_PHASE_LABELS[state.phase]}</span>
  </header>
  {#if state.asOf !== null}<p class="date">As of {dateLabel(state.asOf)}</p>{/if}
  {#if state.phase === 'received'}<p>Accepted for processing. This receipt does not confirm completion or spending.</p>
  {:else if state.phase === 'sending'}<p>On its way. Admission has not been confirmed.</p>
  {:else if state.phase === 'considering'}<p>A decision is being prepared; it has not been submitted.</p>
  {:else if state.phase === 'cancelled'}<p>The decision was cancelled. This does not undo an applied action.</p>
  {:else if state.phase === 'refused'}<p>{refusalText(state.reason ?? '')}</p>{/if}
  {#if state.result?.state === 'rejected'}
    <p>{state.result.kind === 'bribe' ? `Requested payment: ${formatAmount(state.result.amount)} joss paper.` : `Requested target: ${nameLabel(actors[state.result.target]?.name)}.`}</p>
  {/if}
  {#if state.result?.state === 'applied'}
    {@const result = state.result}
    {#if result.kind === 'bribe'}
      <p>Joss paper spent: <strong>{formatAmount(result.amount)}</strong>.</p>
      {#if result.ruling !== null}
        <p>{rulingLabel(result.ruling.applied)}</p>
        <p class="note">{sourceLabel(result.ruling.source)}. {RULING_ACCESS_NOTE}</p>
      {:else}<p>No ruling recorded. No answer is needed from you.</p>{/if}
    {:else}
      <p>Target: {nameLabel(actors[result.target]?.name)}. Joss paper spent: <strong>{formatAmount(result.price)}</strong>.</p>
      <p>Recorded haunting intensity: {formatAmount(result.intensity)}.</p>
      <p class="note">Reported mood adjustment: {formatAmount(result.mood_delta)}. This is not a measured final change in mood or relationship.</p>
    {/if}
  {/if}
  {#if state.dream !== undefined}
    <p>To {nameLabel(actors[state.dream.dreamer]?.name)} · {dreamIntentLabel(state.dream.intent)}</p>
    <p>Joss paper spent: <strong>{formatAmount(state.dream.price)}</strong>.</p>
    {#if state.dream.interpretation !== undefined}
      <p>Recorded response: {dreamResponseLabel(state.dream.interpretation.applied)}.</p>
      <p class="note">{sourceLabel(state.dream.interpretation.source)}. A recorded response does not confirm its effects.</p>
    {:else}<p>No response recorded.</p>{/if}
  {/if}
</article>

<style>
  .receipt { border-top: 1px dashed var(--life-border); padding: 14px 0; color: var(--life-ink); font: 14px/1.5 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
  .stamp { border: 1px solid currentColor; padding: 2px 7px; font-weight: 600; max-width: 100%; overflow-wrap: anywhere; }
  p { margin: 7px 0 0; max-width: 65ch; overflow-wrap: anywhere; }
  .date, .note { color: var(--life-muted); font-size: 13px; }
  .refused .stamp { color: var(--life-event); }
</style>
