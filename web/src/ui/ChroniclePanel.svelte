<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { chronicleLines, EMPTY_CHRONICLE } from '../main/templates.ts';
  const { ui }: { ui: UiState } = $props();
  const lines = $derived(chronicleLines(ui));
</script>

<section class="chronicle" aria-labelledby="chronicle-heading">
  <h2 id="chronicle-heading">Chronicle</h2>
  <p class="context">Reported outcomes, newest first. Named people are those supplied with the stakes; previews are not an applied-effect ledger.</p>
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
  .chronicle { padding: 16px; min-width: 0; border-top: 1px solid var(--life-border); color: var(--life-ink); font: 15px/1.5 system-ui, sans-serif; }
  h2 { margin: 0 0 12px; font-size: 21px; line-height: 1.25; }
  .context { margin: 0 0 16px; color: var(--life-muted); overflow-wrap: anywhere; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { overflow-wrap: anywhere; padding: 12px 0; border-top: 1px solid var(--life-border); font-variant-numeric: tabular-nums; }
  .empty { color: var(--life-muted); }
</style>
