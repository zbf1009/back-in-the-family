<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { namesById } from '../main/view-model.ts';
  import { dateLabel } from '../main/calendar.ts';
  import { kinshipLabel, nameLabel, originLabel } from '../main/player-copy.ts';
  import PeopleCard from './PeopleCard.svelte';
  const { ui }: { ui: UiState } = $props();
  const world = $derived(ui.world);
  const body = $derived(world?.residents.find(person => person.id === world.player.body));
  const ghost = $derived(world?.player_wait?.ghost);
  const names = $derived(world === null ? null : namesById(world));
  function name(person: number): string { return nameLabel(names?.get(person) ?? ui.notebook?.actors[person]?.name); }
  function age(person: number): number | null { return world?.residents.find(resident => resident.id === person)?.age ?? null; }
  const rememberers = $derived(new Set(world?.player.past_life_ties.map(tie => tie.rememberer)).size);
</script>

<section class="identity" aria-labelledby="identity-heading">
  <h2 id="identity-heading">Your people files</h2>
  {#if body !== undefined}
    <PeopleCard person={body.id} name={body.name} age={body.age} detail={originLabel(body.origin)} current />
    <p class="identity-state">Living · {world === null ? '' : dateLabel(world.tick)}</p>
  {:else if world !== null}
    {#if ghost !== undefined}<PeopleCard person={ghost} name={name(ghost)} detail="Waiting between lives" current />
    {:else}<p>Waiting between lives · Name unavailable</p>{/if}
  {:else}<p class="empty">Start a game to open your life notebook.</p>{/if}
  {#if world !== null}
    <details open>
      <summary>Current family · {world.player.blood_ties.length}</summary>
      <div class="files">
        {#each world.player.blood_ties as tie (tie.person)}
          <PeopleCard person={tie.person} name={name(tie.person)} age={age(tie.person)} detail={tie.kinship.map(kinshipLabel).join(', ')} relationship={tie.affinity} />
        {:else}<p class="empty">No current family ties are listed.</p>{/each}
      </div>
    </details>
    <details>
      <summary>Other current connections · {world.player.relations.filter(tie => !world.player.blood_ties.some(family => family.person === tie.person)).length}</summary>
      <div class="files">
        {#each world.player.relations.filter(tie => !world.player.blood_ties.some(family => family.person === tie.person)) as tie (tie.person)}
          <PeopleCard person={tie.person} name={name(tie.person)} age={age(tie.person)} detail={tie.kinship.length === 0 ? 'Current relationship' : tie.kinship.map(kinshipLabel).join(', ')} relationship={tie.affinity} />
        {:else}<p class="empty">No other current connections are listed.</p>{/each}
      </div>
    </details>
    <details>
      <summary>Remembering earlier lives · {rememberers}</summary>
      <p class="note">These people remember a former life. That does not mean they recognize your current one.</p>
      <div class="files">
        {#each world.player.past_life_ties as tie (`${tie.rememberer}:${tie.earlier_body}`)}
          <PeopleCard person={tie.rememberer} name={name(tie.rememberer)} age={age(tie.rememberer)} detail={`Remembers ${name(tie.earlier_body)}`} relationship={tie.affinity} />
        {:else}<p class="empty">No people remembering an earlier life are listed.</p>{/each}
      </div>
    </details>
    <details>
      <summary>Earlier lives · {world.player.earlier_bodies.length}</summary>
      {#each world.player.earlier_bodies as earlier (earlier.id)}
        <div class="earlier-file">
          <PeopleCard person={earlier.id} name={earlier.name} detail={originLabel(earlier.origin)} />
          <p>Died {dateLabel(earlier.death)}{ui.notebook?.actors[earlier.id]?.ageAtDeath !== undefined ? ` · Age ${ui.notebook.actors[earlier.id]!.ageAtDeath}` : ''}</p>
        </div>
      {:else}<p class="empty">This notebook has no earlier lives.</p>{/each}
    </details>
    <p class="note">Portraits are illustrations, not records of anyone's appearance.</p>
  {/if}
</section>

<style>
  .identity { min-width: 0; padding: 20px; color: var(--life-ink); font: 15px/1.5 system-ui, sans-serif; }
  h2 { margin: 0 0 12px; font: 600 24px/1.25 Georgia, serif; }
  .identity-state { margin: 6px 0 24px; }
  details { border-top: 1px solid var(--life-border); padding: 14px 0; }
  summary { cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }
  summary:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  .files { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); column-gap: 24px; }
  .earlier-file > p { margin: 0 0 16px 94px; font-variant-numeric: tabular-nums; }
  .note, .empty { color: var(--life-muted); }
  .note { font-size: 13px; }
  p { overflow-wrap: anywhere; }
</style>
