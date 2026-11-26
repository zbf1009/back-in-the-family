<script lang="ts">
  import type { OperationState } from '../shared/operation-state.ts';
  import type { JournalActors } from '../main/journal-templates.ts';
  import OperationDocument from './OperationDocument.svelte';
  const { operationStates = [], actors }: {
    operationStates?: readonly OperationState[]; actors?: JournalActors;
  } = $props();
</script>

{#if operationStates.length > 0}
  <section class="operation-file" aria-labelledby="operation-file-heading" aria-live="polite">
    <h2 id="operation-file-heading">Your filing receipts</h2>
    <p class="note">Receipts describe each request. Your current life and its recorded outcomes appear separately.</p>
    {#each operationStates as state (`${state.worldId}:${state.requestId}`)}<OperationDocument {state} {actors} />{/each}
  </section>
{/if}

<style>
  .operation-file { padding: 20px; color: var(--life-ink); background: var(--life-paper); font: 15px/1.5 system-ui, sans-serif; }
  h2 { margin: 0 0 10px; font: 600 23px/1.25 Georgia, serif; }
  .note { margin: 0 0 16px; color: var(--life-muted); max-width: 65ch; }
</style>
