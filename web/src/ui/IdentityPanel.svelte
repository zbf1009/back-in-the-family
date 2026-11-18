<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { viewModel } from '../main/view-model.ts';
  import { SOUL_COLOR, SOUL_GLYPH } from '../art/sprites.ts';
  const { ui }: { ui: UiState } = $props();
  const view = $derived(viewModel(ui));
</script>

<section class="identity" aria-labelledby="identity-heading">
  <h2 id="identity-heading">Your soul</h2>
  <div class="current">
    {#if view !== null}
      <span class="soul-marker" style:color={SOUL_COLOR} data-testid="soul-marker" role="img" aria-label="Your soul: gold ring">{SOUL_GLYPH}</span>
    {/if}
    {#if view?.body}
      <div>
        <strong data-testid="current-name">{view.body.name}</strong>
        <p data-testid="current-age">{view.body.age} years · <span data-testid="current-origin">{view.body.origin}</span></p>
      </div>
    {:else}
      <strong>{view === null ? 'No World yet' : 'Between lives'}</strong>
    {/if}
  </div>
  <p class="rememberers" data-testid="rememberer-count">Rememberers: {view?.rememberers ?? 0}</p>
  <div class="ties" role="region" aria-label="Family and earlier lives">
    <h3>Blood ties</h3>
    <ul data-testid="blood-ties">
      {#each view?.bloodTies ?? [] as tie (tie.person)}
        <li>{tie.name} · {tie.kinship.join(', ')}</li>
      {:else}
        <li class="empty">No blood ties.</li>
      {/each}
    </ul>
    <h3>Past-life ties</h3>
    <ul data-testid="past-life-ties">
      {#each view?.pastLifeTies ?? [] as tie (`${tie.rememberer}:${tie.earlier_body}`)}
        <li>{tie.name} remembers {tie.earlierName} · {tie.affinity} affinity</li>
      {:else}
        <li class="empty">No past-life ties.</li>
      {/each}
    </ul>
    <h3>Earlier lives</h3>
    <ul data-testid="earlier-lives">
      {#each view?.earlierBodies ?? [] as body (body.id)}
        <li><span class="earlier-marker" style:color={SOUL_COLOR} role="img" aria-label="Your soul: gold ring">{SOUL_GLYPH}</span> {body.name} · {body.origin}</li>
      {:else}
        <li class="empty">No earlier lives.</li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .identity { display: flex; flex-direction: column; min-height: 0; padding: 16px; }
  h2 { margin: 0 0 12px; font-size: 18px; }
  .current { display: flex; align-items: center; gap: 10px; }
  .soul-marker { flex: none; font: bold 32px/1 sans-serif; }
  strong { font-size: 17px; }
  .current p { margin: 5px 0 0; font-size: 13px; }
  .rememberers { margin: 14px 0; font-variant-numeric: tabular-nums; }
  .ties { min-height: 0; overflow: auto; }
  h3 { margin: 18px 0 6px; font-size: 14px; }
  h3:first-child { margin-top: 0; }
  ul { list-style: none; padding: 0; margin: 0; font-size: 13px; }
  li { margin-bottom: 7px; overflow-wrap: anywhere; }
  .empty { color: #54534f; }
  .earlier-marker { font-weight: bold; font-size: 22px; vertical-align: middle; }
</style>
