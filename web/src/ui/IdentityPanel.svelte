<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import type { Kinship } from '../shared/world-snapshot.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import { namesById } from '../main/view-model.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { kinshipNoun, nameLabel, originLabel } from '../main/player-copy.ts';
  import { TECHNICAL_TEXT } from '../main/technical-text.ts';
  import PeopleCard from './PeopleCard.svelte';
  const { ui, sprites = null }: { ui: UiState; sprites?: SpriteSet | null } = $props();
  const world = $derived(ui.world);
  const body = $derived(world?.residents.find(person => person.id === world.player.body));
  const ghost = $derived(world?.player_wait?.ghost);
  const names = $derived(world === null ? null : namesById(world));
  function name(person: number): string { return nameLabel(names?.get(person) ?? ui.notebook?.actors.get(person)?.name); }
  function historicalAge(person: number): number | null {
    const recorded = ui.notebook?.actors.get(person)?.ageAtDeath;
    if (recorded === undefined) return null;
    const value = Number(recorded);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  function age(person: number): number | null { return world?.residents.find(resident => resident.id === person)?.age ?? historicalAge(person); }
  function sex(person: number): 'female' | 'male' | null {
    return world?.residents.find(resident => resident.id === person)?.sex ?? ui.notebook?.actors.get(person)?.sex ?? null;
  }
  function familyName(person: number, kinship: readonly Kinship[]): string | null {
    const fullName = names?.get(person) ?? ui.notebook?.actors.get(person)?.name;
    if (fullName === undefined || kinship.length === 0) return null;
    const sex = world?.residents.find(resident => resident.id === person)?.sex ?? ui.notebook?.actors.get(person)?.sex;
    const firstName = fullName.trim().split(/\s+/)[0];
    return kinship.map(role => `your ${kinshipNoun(role, sex)} ${firstName}`).join(', ');
  }
  const rememberers = $derived(new Set(world?.player.past_life_ties.map(tie => tie.rememberer)).size);
</script>

<section class="identity" aria-labelledby="identity-heading">
  <h2 id="identity-heading">{TECHNICAL_TEXT.people}</h2>
  {#if body !== undefined}
    <PeopleCard person={body.id} name={body.name} age={body.age} sex={body.sex} {sprites} detail={originLabel(body.origin)} current />
    <p class="identity-state">{world === null ? '' : dateLabel(world.tick)}</p>
  {:else if world !== null}
    {#if ghost !== undefined}<PeopleCard person={ghost} name={name(ghost)} age={historicalAge(ghost)} sex={ui.notebook?.actors.get(ghost)?.sex ?? null} {sprites} detail={TECHNICAL_TEXT.waiting} current />
    {:else}<p>{TECHNICAL_TEXT.waiting}</p>{/if}
    <p class="identity-state">{dateLabel(world.tick)}</p>
  {:else}<p class="empty">{TECHNICAL_TEXT.startGameFirst}</p>{/if}
  {#if world !== null}
    <details open data-testid="blood-ties">
      <summary>{TECHNICAL_TEXT.family} · {world.player.blood_ties.length}</summary>
      <div class="files">
        {#each world.player.blood_ties as tie (tie.person)}
          <PeopleCard person={tie.person} name={name(tie.person)} age={age(tie.person)} sex={sex(tie.person)} {sprites} label={familyName(tie.person, tie.kinship)} relationship={tie.affinity} />
        {:else}<p class="empty">{TECHNICAL_TEXT.noFamily}</p>{/each}
      </div>
    </details>
    <details data-testid="current-relations">
      <summary>{TECHNICAL_TEXT.othersKnown} · {world.player.relations.filter(tie => !world.player.blood_ties.some(family => family.person === tie.person)).length}</summary>
      <div class="files">
        {#each world.player.relations.filter(tie => !world.player.blood_ties.some(family => family.person === tie.person)) as tie (tie.person)}
          <PeopleCard person={tie.person} name={name(tie.person)} age={age(tie.person)} sex={sex(tie.person)} {sprites} label={familyName(tie.person, tie.kinship)} relationship={tie.affinity} />
        {:else}<p class="empty">{TECHNICAL_TEXT.noOthers}</p>{/each}
      </div>
    </details>
    <details data-testid="past-life-ties">
      <summary>{TECHNICAL_TEXT.rememberers} · {rememberers}</summary>
      <div class="files">
        {#each world.player.past_life_ties as tie (`${tie.rememberer}:${tie.earlier_body}`)}
          <PeopleCard person={tie.rememberer} name={name(tie.rememberer)} age={age(tie.rememberer)} sex={sex(tie.rememberer)} {sprites} detail={`Remembers ${name(tie.earlier_body)}`} relationship={tie.affinity} relationshipToEarlierLife />
        {:else}<p class="empty">{TECHNICAL_TEXT.noRememberers}</p>{/each}
      </div>
    </details>
    <details data-testid="earlier-lives">
      <summary>{TECHNICAL_TEXT.earlierLives} · {world.player.earlier_bodies.length}</summary>
      {#each world.player.earlier_bodies as earlier (earlier.id)}
        {@const ageAtDeath = ui.notebook?.actors.get(earlier.id)?.ageAtDeath}
        <div class="earlier-file">
          <PeopleCard person={earlier.id} name={earlier.name} age={historicalAge(earlier.id)} sex={ui.notebook?.actors.get(earlier.id)?.sex ?? null} {sprites} showAge={false} detail={originLabel(earlier.origin)} />
          <p>{TECHNICAL_TEXT.dateOfDeath}: {dateLabel(earlier.death)}{ageAtDeath !== undefined ? ` · ${TECHNICAL_TEXT.memorialAge} ${formatAmount(ageAtDeath)}` : ''}</p>
        </div>
      {:else}<p class="empty">{TECHNICAL_TEXT.firstLife}</p>{/each}
    </details>
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
  .earlier-file > p { margin: 0 0 16px; font-variant-numeric: tabular-nums; }
  .empty { color: var(--life-muted); }
  p { overflow-wrap: anywhere; }
</style>
