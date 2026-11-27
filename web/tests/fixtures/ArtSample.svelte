<script lang="ts">
  import { onMount } from 'svelte';
  import native from './art-sample-seed1205.json';
  import { loadLifeSprites, type SpriteSet } from '../../src/art/sprites.ts';
  import { initialUiState, type UiState } from '../../src/main/ui-state.ts';
  import { createNotebook } from '../../src/main/life-journal.ts';
  import { TECHNICAL_TEXT } from '../../src/main/technical-text.ts';
  import type { StoryActor } from '../../src/shared/story.ts';
  import { claimRequest, dreamRequest, type UnderworldForm } from '../../src/main/customization.ts';
  import type { WorldSnapshot, Slot } from '../../src/shared/world-snapshot.ts';
  import Portrait from '../../src/ui/Portrait.svelte';
  import PortraitCertificate from '../../src/ui/PortraitCertificate.svelte';
  import UnderworldPanel from '../../src/ui/UnderworldPanel.svelte';
  import '../../src/ui/life.css';

  // Exact native World, not a constructed Waiting carrier or altered rules fixture.
  const world = native.world as WorldSnapshot;
  const initial = initialUiState();
  const notebook = createNotebook(1);
  const actors = native.facts.actors as StoryActor[];
  const deceased = actors.find(actor => actor.person === native.facts.death.kind.person)!;
  let ui = $state.raw<UiState>({ ...initial, worldId: 1, world, tick: world.tick,
    notebook: { ...notebook, actors: actors.reduce((root, actor) => root.set(actor.person, actor), notebook.actors) },
    runState: 'paused', checksum: native.source.checksum });
  let sprites = $state.raw<SpriteSet | null>(null);
  let assetError = $state<string | null>(null);
  let certificateOpen = $state(true);
  let callbacks = $state.raw<Record<string, unknown>[]>([]);
  const certificateIdentity = `art-sample:seed${native.source.seed}:death:${native.facts.death.id}:${native.facts.death.tick}:${deceased.person}`;
  const deathAge = deceased.ageAtDeath === undefined ? null : Number(deceased.ageAtDeath);
  const bindings = actors.map(actor => ({ person: actor.person, sex: actor.sex, name: actor.name,
    age: world.residents.find(resident => resident.id === actor.person)?.age
      ?? (actor.ageAtDeath === undefined ? null : Number(actor.ageAtDeath)) }));
  function record(value: Record<string, unknown>): void { callbacks = [...callbacks, value]; }
  function onForm(form: UnderworldForm): void {
    ui = { ...ui, underworldForm: form };
    record({ kind: 'form', form });
  }
  async function onDream(): Promise<void> { record({ kind: 'dream', request: dreamRequest(world, ui.underworldForm) }); }
  async function onClaim(slot: Slot): Promise<void> { record({ kind: 'claim', request: claimRequest(ui.underworldForm, slot) }); }
  function onBribe(worldId: number, amount: string): void { record({ kind: 'bribe', worldId, amount }); }
  function onHaunt(worldId: number, target: number): void { record({ kind: 'haunt', worldId, target }); }
  function onClose(identity: string): void {
    if (identity !== certificateIdentity || !certificateOpen) return;
    certificateOpen = false;
    record({ kind: 'close', identity });
  }
  onMount(() => {
    void loadLifeSprites().then(value => { sprites = value; })
      .catch(error => { assetError = error instanceof Error ? error.message : String(error); });
  });
</script>

<main data-testid="art-sample" data-assets={assetError !== null ? 'error' : sprites === null ? 'loading' : 'ready'}>
  <header><h1>{TECHNICAL_TEXT.title}</h1><a href="/credits.html">{TECHNICAL_TEXT.credits}</a></header>
  {#if assetError !== null}
    <p role="alert">{TECHNICAL_TEXT.picturesFailed}</p>
  {:else if sprites === null}
    <p role="status">{TECHNICAL_TEXT.picturesLoading}</p>
  {:else}
    {#if certificateOpen}
      <PortraitCertificate {sprites} person={deceased.person} sex={deceased.sex} name={deceased.name} deathDay={native.facts.death.tick} age={deathAge} identity={certificateIdentity} {onClose} />
    {/if}
  {/if}
  <UnderworldPanel {ui} {sprites} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} />
  {#if sprites !== null}
    <div class="portrait-proof" aria-label="Portraits">
      {#each bindings as binding}
        <figure><Portrait portraits={sprites.portraits} person={binding.person} sex={binding.sex} age={binding.age} label={binding.name} pixelScale={2} /><figcaption>{binding.name}</figcaption></figure>
      {/each}
    </div>
  {/if}
  <details class="source">
    <summary>Source</summary>
    <p>Names, sex, age and the waiting World come from the preserved seed-1205 native facts. The current portrait pool uses those subjects with ID-bound skin and hair palettes. The existing legal Underworld controls record callbacks here; they do not send simulation inputs or establish admission, spending, a dream or rebirth.</p>
    <p>Nadine Bradley: actual Death Event 2368, day 5372; native age-at-death 60. The page uses the completed-day-5373 World, not day 5373 as the death date. Facts: target/life-unfolds/default-play-facts.json. World/input provenance: web/tests/fixtures/art-sample-seed1205.json.</p>
    <pre>{JSON.stringify(native.source, null, 2)}</pre>
    {#if assetError !== null}<pre>{assetError}</pre>{/if}
    <pre data-testid="art-sample-callbacks">{JSON.stringify(callbacks, null, 2)}</pre>
  </details>
  <footer><p>Portraits adapted from <a href="https://opengameart.org/content/character-portrait-kit">Character portrait kit</a> by <a href="https://opengameart.org/users/dezrasdragons">Dezra's Dragons</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC-BY 4.0</a>. Cropped, assembled, recolored and manually edited into modern clothing. <a href="/credits.html">{TECHNICAL_TEXT.credits}</a></p></footer>
</main>

<style>
  :global(body) { margin: 0; background: #eee8d4; color: #263b3c; font-family: system-ui, sans-serif; }
  main { max-width: 896px; padding: 24px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 24px; }
  h1 { font: 400 clamp(24px, 3vw, 34px)/1.2 Georgia, serif; margin: 0; }
  a { color: #255864; text-underline-offset: 3px; }
  a:focus-visible, summary:focus-visible { outline: 3px solid #315e65; outline-offset: 3px; }
  .portrait-proof { display: flex; flex-wrap: wrap; justify-content: center; gap: 32px; padding: 28px 0; }
  figure { margin: 0; background: #f5efd6; padding: 12px; }
  figcaption { margin-top: 10px; font: 16px/1.3 Georgia, serif; max-width: 15ch; }
  .source { border-top: 1px solid #a8ab91; padding-top: 16px; margin-top: 28px; }
  summary { cursor: pointer; }
  .source p { max-width: 72ch; line-height: 1.6; }
  pre { overflow: auto; font-size: 12px; line-height: 1.45; }
  footer { margin-top: 32px; font-size: 13px; line-height: 1.6; color: #4b5d55; }
  ::selection { background: #c6d4b9; color: #172d2e; }
  @media (max-width: 620px) { main { padding: 16px; } }
</style>
