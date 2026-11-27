<script lang="ts">
  import type { Kinship, WorldSnapshot } from '../shared/world-snapshot.ts';
  import type { JournalActors } from '../main/journal-templates.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import { dateLabel } from '../main/calendar.ts';
  import { kinshipNoun, nameLabel } from '../main/player-copy.ts';
  import { TECHNICAL_TEXT, supportedText } from '../main/technical-text.ts';
  import PeopleCard from './PeopleCard.svelte';
  const { world, actors, sprites = null }: { world: WorldSnapshot; actors?: JournalActors; sprites?: SpriteSet | null } = $props();
  const body = $derived(world.residents.find(person => person.id === world.player.body));
  const household = $derived(world.households.find(home => home.id === body?.household));
  const members = $derived(world.residents.filter(person => person.id !== body?.id && person.alive && household?.members.includes(person.id)));
  const relatives = $derived(world.player.blood_ties.flatMap(tie => {
    const person = world.residents.find(resident => resident.id === tie.person && resident.alive);
    return person === undefined || household?.members.includes(person.id) ? [] : [{ ...tie, resident: person }];
  }));
  const openingLine = $derived(body === undefined ? null : supportedText(
    body.origin === 'native' ? TECHNICAL_TEXT.openingNative : body.origin === 'possessed' ? TECHNICAL_TEXT.openingBorrowed : TECHNICAL_TEXT.openingRebuilt,
    { 'Full Name': body.name, n: String(body.age) },
  ));
  function familyName(person: WorldSnapshot['residents'][number], kinship: readonly Kinship[]): string {
    const firstName = person.name.trim().split(/\s+/)[0];
    const names = kinship.map(role => `your ${kinshipNoun(role, person.sex)} ${firstName}`);
    return `${names.length === 0 ? person.name : names.join(', ')}, ${person.age}`;
  }
</script>

<section class="opening" aria-labelledby="opening-heading">
  <header><h2 id="opening-heading">{TECHNICAL_TEXT.openingHeading}</h2><p>{dateLabel(world.tick)}</p></header>
  {#if body !== undefined}
    <PeopleCard person={body.id} name={body.name} age={body.age} sex={body.sex} {sprites} label={openingLine} showAge={false} current />
  {:else}<p>{nameLabel(world.player.body === null ? undefined : actors?.get(world.player.body)?.name)}</p>{/if}
  <div class="family-pages">
    {#if household !== undefined}
    <section aria-labelledby="opening-household"><h3 id="opening-household">{TECHNICAL_TEXT.openingHome}</h3>
      {#each members as member (member.id)}
        {@const tie = world.player.blood_ties.find(tie => tie.person === member.id)}
        <PeopleCard person={member.id} name={member.name} age={member.age} sex={member.sex} {sprites} label={familyName(member, tie?.kinship ?? [])} showAge={false} />
      {:else}<p class="empty">{TECHNICAL_TEXT.openingAlone}</p>{/each}
    </section>
    {/if}
    {#if relatives.length > 0}
      <section aria-labelledby="opening-relatives"><h3 id="opening-relatives">{TECHNICAL_TEXT.openingFamily}</h3>
        {#each relatives as relative (relative.person)}
          <PeopleCard person={relative.person} name={relative.resident.name} age={relative.resident.age} sex={relative.resident.sex} {sprites} label={familyName(relative.resident, relative.kinship)} showAge={false} />
        {/each}
      </section>
    {/if}
  </div>
  <p class="invitation">{TECHNICAL_TEXT.openingFooter}</p>
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
