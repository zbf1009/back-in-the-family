<script lang="ts">
  import type { SpriteSet } from '../art/sprites.ts';
  import { PORTRAIT_CELL } from '../art/portraits.ts';
  import Portrait from './Portrait.svelte';
  import { nameLabel } from '../main/player-copy.ts';
  import { TECHNICAL_TEXT, supportedText } from '../main/technical-text.ts';
  const { person, name, age = null, sex = null, sprites = null, pixelScale = 2, detail = '', relationship = null, current = false, label = null, showAge = true, relationshipToEarlierLife = false }: {
    person: number; name?: string | null; age?: number | null; sex?: 'female' | 'male' | null;
    sprites?: SpriteSet | null; pixelScale?: number; detail?: string;
    relationship?: number | null; current?: boolean; label?: string | null; showAge?: boolean; relationshipToEarlierLife?: boolean;
  } = $props();
</script>

<div class="people-card" class:current data-testid="people-card" data-person={person} data-sex={sex ?? 'unknown'} data-age={age ?? 'unknown'} data-relationship={relationship ?? undefined} data-earlier-life-relationship={relationshipToEarlierLife}>
  <div class="portrait" style:width={`${PORTRAIT_CELL * pixelScale}px`} style:height={`${PORTRAIT_CELL * pixelScale}px`}>
    <Portrait portraits={sprites?.portraits ?? null} {person} {sex} {age} label={nameLabel(name)} {pixelScale} />
  </div>
  <div class="person-file">
    <strong>{label ?? nameLabel(name)}</strong>
    {#if label !== null && !label.includes(nameLabel(name))}<span class="sr-only">{nameLabel(name)}</span>{/if}
    {#if showAge && age !== null}<span class="age">{TECHNICAL_TEXT.memorialAge} {age}</span>{/if}
    {#if detail}<p>{detail}</p>{/if}
    {#if relationship !== null}
      <p class="relationship">{relationshipToEarlierLife ? `Relationship: ${relationship > 0 ? '+' : relationship < 0 ? '−' : ''}${Math.abs(relationship)}` : relationship === 0 ? TECHNICAL_TEXT.relationshipNeutral : supportedText(relationship > 0 ? TECHNICAL_TEXT.relationshipPositive : TECHNICAL_TEXT.relationshipNegative, { n: relationship > 0 ? `+${relationship}` : `−${Math.abs(relationship)}` })}</p>
    {/if}
  </div>
</div>

<style>
  .people-card { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; min-width: 0; padding: 12px 0; color: var(--life-ink); }
  .portrait { flex: none; box-sizing: content-box; overflow: hidden; background: var(--life-secondary); border-bottom: 2px solid var(--life-border); }
  .person-file { min-width: min(100%, 140px); flex: 1; }
  strong { display: block; font: 600 18px/1.3 system-ui, sans-serif; overflow-wrap: anywhere; }
  .current strong { font-size: 25px; }
  p, .age { margin: 5px 0 0; font: 14px/1.45 system-ui, sans-serif; overflow-wrap: anywhere; }
  .age { display: block; }
  .relationship { color: var(--life-muted); font-variant-numeric: tabular-nums; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
