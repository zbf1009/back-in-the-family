<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { chronicleLines, EMPTY_CHRONICLE } from '../main/templates.ts';
  const { ui }: { ui: UiState } = $props();
  const lines = $derived(chronicleLines(ui));
</script>

<section class="chronicle" aria-labelledby="chronicle-heading">
  <h2 id="chronicle-heading">Chronicle</h2>
  <div class="entries" role="region" aria-label="Chronicle entries">
    <ol data-testid="chronicle">
      {#each lines as line, index (index)}
        <li data-testid="chronicle-entry">{line}</li>
      {:else}
        <li class="empty" data-testid="chronicle-empty">{EMPTY_CHRONICLE}</li>
      {/each}
    </ol>
  </div>
</section>

<style>
  .chronicle { padding: 16px; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid #c6c3b9; }
  h2 { margin: 0 0 12px; font-size: 18px; }
  .entries { min-height: 0; overflow: auto; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; padding-bottom: 12px; }
  .empty { color: #54534f; }
</style>
