<script lang="ts">
  import type { ObituaryEntry } from '../main/obituary-store.ts';
  import { TECHNICAL_TEXT } from '../main/technical-text.ts';
  const { entry }: { entry: ObituaryEntry } = $props();
</script>

{#if entry.ready && entry.result !== null}
  <section class="obituary" aria-labelledby={`obituary-${entry.death.eventId}`} data-testid="obituary" data-death={entry.death.eventId}>
    <h2 id={`obituary-${entry.death.eventId}`}>{TECHNICAL_TEXT.obituaryTitle}</h2>
    <p aria-live="polite" aria-atomic="true">{entry.result.text}</p>
  </section>
{/if}

<style>
  .obituary { margin: 24px 0; padding: clamp(18px, 3vw, 30px); border: 1px solid var(--life-border); background: var(--life-paper); min-width: 0; }
  h2 { margin: 0 0 16px; font: 400 30px/1.2 Georgia, 'Times New Roman', serif; }
  p { margin: 0; max-width: 68ch; font: 18px/1.65 Georgia, 'Times New Roman', serif; white-space: pre-line; overflow-wrap: anywhere; }
</style>
