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
  {#if ui.world !== null}
    <p class="identity-state" data-testid="identity-state">Soul {ui.world.player_soul} · {ui.world.player.place === 'waiting' ? 'Waiting between lives' : `Current body ${ui.world.player.body}`}</p>
  {/if}
  <p class="rememberers" data-testid="rememberer-count">Rememberers: {view?.rememberers ?? 0}</p>
  <div class="ties" role="region" aria-label="Family and earlier lives">
    <h3>Blood ties</h3>
    <ul data-testid="blood-ties">
      {#each view?.bloodTies ?? [] as tie (tie.person)}
        <li>{tie.name} · {tie.kinship.join(', ')} · {tie.affinity} affinity</li>
      {:else}
        <li class="empty">No blood ties.</li>
      {/each}
    </ul>
    <h3>Current-body relations</h3>
    <ul data-testid="current-relations">
      {#each view?.relations ?? [] as tie (tie.person)}
        <li>{tie.name} · {tie.affinity} affinity{tie.kinship.length > 0 ? ` · ${tie.kinship.join(', ')}` : ''}</li>
      {:else}
        <li class="empty">No current-body relations.</li>
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
        <li><span class="earlier-marker" style:color={SOUL_COLOR} role="img" aria-label="Your soul: gold ring">{SOUL_GLYPH}</span> {body.name} · {body.origin} · body {body.id} · died at tick {body.death}</li>
      {:else}
        <li class="empty">No earlier lives.</li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .identity { min-width: 0; padding: 16px; color: var(--life-ink); font: 15px/1.5 system-ui, sans-serif; }
  h2 { margin: 0 0 12px; font-size: 21px; line-height: 1.25; }
  .current { display: flex; align-items: center; gap: 10px; }
  .current > div { min-width: 0; }
  .soul-marker { flex: none; font: bold 32px/1 sans-serif; }
  strong { font-size: 17px; overflow-wrap: anywhere; }
  .current p { margin: 5px 0 0; }
  .identity-state, .rememberers { margin: 12px 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  h3 { margin: 24px 0 8px; font-size: 15px; }
  h3:first-child { margin-top: 0; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { margin-bottom: 10px; overflow-wrap: anywhere; }
  .empty { color: var(--life-muted); }
  .earlier-marker { font-weight: bold; font-size: 22px; vertical-align: middle; }
</style>
