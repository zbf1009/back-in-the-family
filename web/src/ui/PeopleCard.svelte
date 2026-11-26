<script lang="ts">
  import { LIFE_ATLASES, LIFE_TILES } from '../art/life-view-atlas.ts';
  import { resolveVisualKey } from '../art/sprites.ts';
  import { nameLabel } from '../main/player-copy.ts';
  const { person, name, age = null, detail = '', relationship = null, current = false }: {
    person: number; name?: string | null; age?: number | null; detail?: string;
    relationship?: number | null; current?: boolean;
  } = $props();
  const tile = $derived(LIFE_TILES[resolveVisualKey(person, age)]);
  const atlas = $derived(LIFE_ATLASES[tile.atlas]);
</script>

<div class="people-card" class:current>
  <div class="portrait" aria-hidden="true">
    <span class="sprite" style:background-image={`url(${import.meta.env.BASE_URL}${atlas.path})`}
      style:background-size={`${atlas.width * 5}px ${atlas.height * 5}px`}
      style:background-position={`${-tile.x * 5}px ${-tile.y * 5}px`}></span>
  </div>
  <div class="person-file">
    <strong>{nameLabel(name)}</strong>
    {#if age !== null}<span class="age">Age {age}</span>{/if}
    {#if detail}<p>{detail}</p>{/if}
    {#if relationship !== null}<p class="relationship">Relationship: {relationship > 0 ? '+' : ''}{relationship}</p>{/if}
  </div>
</div>

<style>
  .people-card { display: flex; align-items: center; gap: 14px; min-width: 0; padding: 12px 0; color: var(--life-ink); }
  .portrait { width: 80px; height: 88px; flex: none; display: grid; place-items: end center; background: var(--life-secondary); border-bottom: 1px solid var(--life-border); }
  .sprite { display: block; width: 80px; height: 80px; image-rendering: pixelated; background-repeat: no-repeat; }
  .person-file { min-width: 0; }
  strong { display: block; font: 600 18px/1.3 system-ui, sans-serif; overflow-wrap: anywhere; }
  .current strong { font-size: 25px; }
  p, .age { margin: 5px 0 0; font: 14px/1.45 system-ui, sans-serif; overflow-wrap: anywhere; }
  .age { display: block; }
  .relationship { color: var(--life-muted); font-variant-numeric: tabular-nums; }
</style>
