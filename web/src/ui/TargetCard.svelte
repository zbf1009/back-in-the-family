<script lang="ts">
  import type { SpriteSet } from '../art/sprites.ts';
  import Portrait from './Portrait.svelte';
  const { person, name, age = null, sex, sprites = null, group, selected, disabled = false, reason = null, onSelect }: {
    person: number; name: string; age?: number | null; sex?: 'female' | 'male'; sprites?: SpriteSet | null; group: 'dream' | 'haunt';
    selected: boolean; disabled?: boolean; reason?: string | null; onSelect: () => void;
  } = $props();
</script>

<label class="target-card" class:selected class:unavailable={disabled}>
  <input type="radio" name={`${group}-target`} data-testid={`${group}-target-${person}`} value={person}
    checked={selected} {disabled} aria-describedby={reason === null ? undefined : `${group}-reason-${person}`} onchange={onSelect} />
  <span class="portrait-frame"><Portrait portraits={sprites?.portraits ?? null} {person} {sex} {age} label={name} pixelScale={1} /></span>
  <span class="person"><strong>{name}</strong>{#if age !== null}<span class="age">{age}</span>{/if}
    {#if reason !== null}<span id={`${group}-reason-${person}`} class="reason">{reason}</span>{/if}
  </span>
</label>

<style>
  .target-card { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 8px 10px; box-sizing: border-box; border: 1px solid var(--life-border); background: var(--life-paper); cursor: pointer; }
  .portrait-frame { flex: none; width: 64px; height: 64px; overflow: hidden; border-bottom: 3px solid var(--life-border); }
  .selected { border-color: var(--life-accent); background: var(--life-secondary); }
  .unavailable { cursor: not-allowed; }
  input { flex: none; width: 18px; height: 18px; margin: 0; accent-color: var(--life-accent); }
  input:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  .person { min-width: 0; flex: 1; font: 14px/1.4 system-ui, sans-serif; overflow-wrap: anywhere; }
  strong { font-weight: 600; }
  .age { margin-left: 8px; font-variant-numeric: tabular-nums; }
  .reason { display: block; margin-top: 4px; color: var(--life-muted); font-size: 13px; }
</style>
