<script lang="ts">
  import type { WorldSnapshot } from '../shared/world-snapshot.ts';
  import type { JournalActors } from '../main/journal-templates.ts';
  import { dateLabel } from '../main/calendar.ts';
  import { kinshipLabel, nameLabel, originLabel } from '../main/player-copy.ts';
  import PeopleCard from './PeopleCard.svelte';
  const { world, actors }: { world: WorldSnapshot; actors?: JournalActors } = $props();
  const body = $derived(world.residents.find(person => person.id === world.player.body));
  const household = $derived(world.households.find(home => home.id === body?.household));
  const members = $derived(world.residents.filter(person => person.id !== body?.id && person.alive && household?.members.includes(person.id)));
  const relatives = $derived(world.player.blood_ties.flatMap(tie => {
    const person = world.residents.find(resident => resident.id === tie.person && resident.alive);
    return person === undefined || household?.members.includes(person.id) ? [] : [{ ...tie, resident: person }];
  }));
</script>

<section class="opening" aria-labelledby="opening-heading">
  <header><h2 id="opening-heading">Your life begins here</h2><p>{dateLabel(world.tick)}</p></header>
  {#if body !== undefined}
    <PeopleCard person={body.id} name={body.name} age={body.age} detail={originLabel(body.origin)} current />
  {:else}<p>{nameLabel(world.player.body === null ? undefined : actors?.get(world.player.body)?.name)}</p>{/if}
  <p class="invitation">The day is yours when you press Play. Nothing advances while you read.</p>
  <div class="family-pages">
    <section aria-labelledby="opening-household"><h3 id="opening-household">Your household</h3>
      {#each members as member (member.id)}
        {@const tie = world.player.blood_ties.find(tie => tie.person === member.id)}
        <PeopleCard person={member.id} name={member.name} age={member.age} detail={tie?.kinship.map(kinshipLabel).join(', ') ?? 'Household member'} />
      {:else}<p class="empty">No other living household members are listed.</p>{/each}
    </section>
    <section aria-labelledby="opening-relatives"><h3 id="opening-relatives">Other living family</h3>
      {#each relatives as relative (relative.person)}
        <PeopleCard person={relative.person} name={relative.resident.name} age={relative.resident.age} detail={relative.kinship.map(kinshipLabel).join(', ')} />
      {:else}<p class="empty">No other living relatives are listed.</p>{/each}
    </section>
  </div>
</section>

<style>
  .opening { padding: clamp(18px, 3vw, 32px); background: var(--life-paper); color: var(--life-ink); border-top: 2px solid var(--life-ink); font: 15px/1.5 system-ui, sans-serif; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h2 { margin: 0; font: 600 27px/1.2 Georgia, serif; }
  header p { margin: 0; color: var(--life-muted); }
  .invitation { margin: 20px 0 28px; max-width: 65ch; }
  .family-pages { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 28px; }
  .family-pages > section { min-width: 0; }
  h3 { border-bottom: 1px solid var(--life-border); padding-bottom: 8px; margin: 0 0 8px; font-size: 16px; }
  .empty { color: var(--life-muted); }
  p { overflow-wrap: anywhere; }
</style>
