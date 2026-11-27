<script lang="ts">
  import type { OperationState } from '../shared/operation-state.ts';
  import type { JournalActors } from '../main/journal-templates.ts';
  import { OPERATION_LABELS, OPERATION_PHASE_LABELS } from '../main/player-copy.ts';
  const { state }: { state: OperationState; actors?: JournalActors } = $props();
</script>

<article class="receipt" class:refused={state.phase === 'refused'} aria-label={`${OPERATION_LABELS[state.kind]} receipt`}
  data-testid="operation-receipt" data-kind={state.kind} data-phase={state.phase} data-world={state.worldId} data-request={state.requestId} data-inputs={state.inputSeqs.join(',')}>
  <header><strong>{OPERATION_LABELS[state.kind]}</strong>
    <span class="stamp">{OPERATION_PHASE_LABELS[state.phase]}</span>
  </header>
</article>

<style>
  .receipt { border-top: 1px dashed var(--life-border); padding: 14px 0; color: var(--life-ink); font: 14px/1.5 system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
  .stamp { border: 1px solid currentColor; padding: 2px 7px; font-weight: 600; max-width: 100%; overflow-wrap: anywhere; }
  .refused .stamp { color: var(--life-event); }
</style>
