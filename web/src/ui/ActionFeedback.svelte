<script lang="ts">
  import type { OperationState } from '../shared/operation-state.ts';
  import type { JournalActors } from '../main/journal-templates.ts';
  import { TECHNICAL_TEXT } from '../main/technical-text.ts';
  import OperationDocument from './OperationDocument.svelte';
  const { operationStates = [], actors }: {
    operationStates?: readonly OperationState[]; actors?: JournalActors;
  } = $props();
</script>

{#if operationStates.length > 0}
  <section class="operation-file" aria-labelledby="operation-file-heading" aria-live="polite">
    <h2 id="operation-file-heading">{TECHNICAL_TEXT.paperwork}</h2>
    {#each operationStates as state (`${state.worldId}:${state.requestId}`)}<OperationDocument {state} {actors} />{/each}
  </section>
{/if}

<style>
  .operation-file { padding: 20px; color: var(--life-ink); background: var(--life-paper); font: 15px/1.5 system-ui, sans-serif; }
  h2 { margin: 0 0 10px; font: 600 23px/1.25 Georgia, serif; }
</style>
