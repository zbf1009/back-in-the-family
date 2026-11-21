<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { decisionBusy } from '../main/ui-state.ts';
  import type { Slot, TraitName } from '../shared/world-snapshot.ts';
  import { DREAM_INTENTS } from '../shared/protocol.ts';
  import { underworldView } from '../main/view-model.ts';
  import { TRAITS, blankCustomization, customizationPreview, type CustomizationForm, type UnderworldForm } from '../main/customization.ts';
  import { SOUL_COLOR, SOUL_GLYPH } from '../art/sprites.ts';
  const { ui, onForm, onDream, onClaim }: {
    ui: UiState; onForm: (form: UnderworldForm) => void; onDream: () => Promise<void>; onClaim: (slot: Slot) => Promise<void>;
  } = $props();
  const view = $derived(underworldView(ui));
  const form = $derived(ui.underworldForm.customization);
  const preview = $derived(ui.world === null ? null : customizationPreview(ui.world, ui.underworldForm));
  type SlotView = NonNullable<ReturnType<typeof underworldView>>['slots'][number];
  function selected(event: Event): string { return (event.currentTarget as HTMLSelectElement).value; }
  function patch(patch: Partial<UnderworldForm>): void { onForm({ ...ui.underworldForm, ...patch }); }
  function setPatch(patch: Partial<Extract<CustomizationForm, { kind: 'Set' }>>): void {
    const current = ui.underworldForm.customization;
    if (current?.kind === 'Set') onForm({ ...ui.underworldForm, customization: { ...current, ...patch } });
  }
  function adjustPatch(patch: Partial<Extract<CustomizationForm, { kind: 'Adjust' }>>): void {
    const current = ui.underworldForm.customization;
    if (current?.kind === 'Adjust') onForm({ ...ui.underworldForm, customization: { ...current, ...patch } });
  }
  function trait(event: Event): TraitName | null { const value = selected(event); return value === '' ? null : value as TraitName; }
  function delta(event: Event): -1 | 1 | null { const value = selected(event); return value === '' ? null : Number(value) as -1 | 1; }
</script>

{#snippet slotRow(slot: SlotView)}
  <li class="slot-row" data-testid={`slot-${slot.slot}`}>
    <div class="slot-header">
      <span><strong>{slot.kind}</strong> · {slot.price} joss paper{slot.birth !== null ? ` · tick ${slot.birth}` : ''}</span>
      {#if slot.slot === 'rebuilt_body'}
        <button type="button" data-testid="customize" onclick={() => patch({ customization: form === null ? blankCustomization('Set') : null })}>Customize</button>
      {/if}
      <button type="button" data-testid={`claim-${slot.slot}`} aria-label={`Claim ${slot.slot}`} disabled={!slot.claimEnabled || decisionBusy(ui)} onclick={() => onClaim(slot.slot)}>Claim</button>
    </div>
    <div class="path" data-testid={`path-${slot.slot}`}>
      <p>announced {slot.status.announced ? 'yes' : 'no'} · claimable {slot.status.claimable ? 'yes' : 'no'} · affordable {slot.status.affordable ? 'yes' : 'no'}</p>
      {#if slot.needed.length > 0}<p>{slot.needed.join('; ')}</p>{/if}
    </div>
    {#if slot.slot === 'rebuilt_body' && form !== null}
      <div class="customization" data-testid="customization-panel">
        <div class="form-heading">
          <label>Customization
            <select data-testid="customization-kind" value={form.kind} onchange={event => patch({ customization: blankCustomization(selected(event) as 'Set' | 'Adjust') })}>
              <option value="Set">Set</option><option value="Adjust">Adjust</option>
            </select>
          </label>
          <button type="button" data-testid="customization-cancel" onclick={() => patch({ customization: null })}>Cancel</button>
        </div>
        {#if form.kind === 'Set'}
          <div class="form-fields">
            <label>Trait <select data-testid="customization-trait" value={form.trait ?? ''} onchange={event => setPatch({ trait: trait(event) })}>
              <option value="">Choose a Trait</option>{#each TRAITS as name (name)}<option value={name}>{name}</option>{/each}
            </select></label>
            <label>Value <select data-testid="customization-value" value={form.value ?? ''} onchange={event => setPatch({ value: selected(event) === '' ? null : Number(selected(event)) })}>
              <option value="">Choose a value</option>{#each [-3, -2, -1, 0, 1, 2, 3] as value (value)}<option value={value}>{value}</option>{/each}
            </select></label>
          </div>
        {:else}
          <div class="form-fields adjust">
            <label>First Trait <select data-testid="customization-first" value={form.first ?? ''} onchange={event => adjustPatch({ first: trait(event) })}>
              <option value="">Choose a Trait</option>{#each TRAITS as name (name)}<option value={name}>{name}</option>{/each}
            </select></label>
            <label>Change <select data-testid="customization-first-delta" value={form.firstDelta ?? ''} onchange={event => adjustPatch({ firstDelta: delta(event) })}>
              <option value="">Choose</option><option value={1}>+1</option><option value={-1}>-1</option>
            </select></label>
            <label>Second Trait <select data-testid="customization-second" value={form.second ?? ''} onchange={event => adjustPatch({ second: trait(event) })}>
              <option value="">Choose a Trait</option>{#each TRAITS as name (name)}<option value={name}>{name}</option>{/each}
            </select></label>
            <label>Change <select data-testid="customization-second-delta" value={form.secondDelta ?? ''} onchange={event => adjustPatch({ secondDelta: delta(event) })}>
              <option value="">Choose</option><option value={1}>+1</option><option value={-1}>-1</option>
            </select></label>
          </div>
        {/if}
        {#if preview !== null}
          <table data-testid="customization-preview">
            <thead><tr><th>Trait</th><th>Base</th><th>Customized</th><th>Price</th></tr></thead>
            <tbody>{#each preview.values as row (row.trait)}<tr><th>{row.trait}</th><td>{row.base}</td><td>{row.customized}</td><td>{preview.price}</td></tr>{/each}</tbody>
          </table>
          {#if preview.override !== null}<p data-testid="customization-override">{preview.override}</p>{/if}
        {:else}<p class="note">Choose a complete customization.</p>{/if}
      </div>
    {/if}
  </li>
{/snippet}

{#if view !== null}
  <section class="underworld" aria-labelledby="underworld-heading" data-testid="underworld-panel">
    <div class="header">
      <span class="soul-marker" style:color={SOUL_COLOR} data-testid="underworld-soul-marker" role="img" aria-label="Your soul: gold ring">{SOUL_GLYPH}</span>
      <h2 id="underworld-heading">Underworld</h2>
      <span data-testid="joss-balance">Joss paper: <strong>{view.balance}</strong></span>
    </div>
    <div class="dream" data-testid="dream-controls">
      <div class="dream-send">
        <label>Dreamer <select data-testid="dreamer" value={ui.underworldForm.dreamer ?? ''} onchange={event => patch({ dreamer: Number(selected(event)) })}>
          {#if view.connected.length === 0}<option value="">No connected people</option>{/if}
          {#each view.connected as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
        </select></label>
        <button type="button" data-testid="dream-send" disabled={!view.dreamEnabled || decisionBusy(ui)} onclick={onDream}>Send dream (<span data-testid="dream-price">{view.dreamPrice}</span> joss paper)</button>
      </div>
      <div class="intents" role="group" aria-label="Dream intent">
        {#each DREAM_INTENTS as intent (intent)}
          <button type="button" data-testid={`dream-intent-${intent}`} aria-pressed={ui.underworldForm.intent === intent} onclick={() => patch({ intent })}>{intent}</button>
        {/each}
      </div>
      {#each view.dreamReasons as reason (reason)}<p class="note">{reason}</p>{/each}
    </div>
    <label class="carry">Carry over
      <select data-testid="carry-over" value={ui.underworldForm.carryOver ?? ''} onchange={event => patch({ carryOver: trait(event) })}>
        <option value="">None</option>{#each TRAITS as name (name)}<option value={name}>{name}: {view.ghostTraits[name]}</option>{/each}
      </select>
    </label>
    <div class="birth-group">
      <h3 data-testid="birth-slot-count">Birth slots: {view.slots.filter(slot => slot.kind === 'birth_slot').length}</h3>
      <ul class="birth-slots" data-testid="birth-slots" aria-label="Birth slots">
        {#each view.slots.filter(slot => slot.kind === 'birth_slot') as slot (slot.slot)}{@render slotRow(slot)}{/each}
      </ul>
    </div>
    <ul class="standing" aria-label="Standing slots">
      {#each view.slots.filter(slot => slot.kind !== 'birth_slot') as slot (slot.slot)}{@render slotRow(slot)}{/each}
    </ul>
    {#if ui.underworldRecorded !== null}<p class="recorded" data-testid="underworld-recorded" role="status">Recorded. It takes effect when time runs.</p>{/if}
    {#if ui.error !== null}<p class="error" data-testid="underworld-error" role="alert">Rejected: {ui.error}</p>{/if}
  </section>
{/if}

<style>
  .underworld { padding: 12px 16px; min-height: 680px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.2; }
  .underworld > * { flex-shrink: 0; }
  .header { display: flex; align-items: center; gap: 8px; }
  .soul-marker { font: bold 26px/1 sans-serif; }
  h2 { font-size: 18px; margin: 0; }
  .header > span:last-child { margin-left: auto; font-size: 12px; }
  h3 { font-size: 13px; margin: 0 0 4px; }
  p { margin: 0; }
  label { display: flex; flex-direction: column; gap: 2px; }
  select { min-width: 0; width: 100%; font-size: 12px; height: 26px; padding: 2px 4px; }
  button { font-size: 12px; min-height: 24px; padding: 2px 4px; line-height: 1.2; }
  .dream-send { display: grid; grid-template-columns: minmax(0, 1fr) 145px; gap: 6px; align-items: end; }
  .intents { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin-top: 4px; }
  .intents button[aria-pressed="true"] { color: #fffefa; background: #252525; }
  .carry { display: grid; grid-template-columns: 85px minmax(0, 1fr); align-items: center; }
  ul { list-style: none; margin: 0; padding: 0; }
  .birth-slots { height: 216px; overflow: auto; scrollbar-color: #858585 #eeede6; scrollbar-width: thin; }
  .slot-row { min-height: 54px; border-bottom: 1px solid #c6c3b9; }
  .slot-header { display: flex; align-items: center; gap: 4px; min-height: 24px; }
  .slot-header > span { flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
  .slot-header button { flex: none; }
  .path { font-size: 12px; line-height: 14px; overflow-wrap: anywhere; }
  .customization { padding: 6px 0; }
  .form-heading { display: flex; align-items: end; justify-content: space-between; gap: 6px; }
  .form-heading label { flex-direction: row; align-items: center; gap: 6px; }
  .form-heading select { width: 90px; }
  .form-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 6px; margin-top: 4px; }
  .form-fields.adjust { grid-template-columns: minmax(0, 1fr) 85px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 1px 4px 1px 0; }
  .note { color: #54534f; font-size: 12px; margin-top: 4px; }
  .error { color: #9b2520; }
  .recorded { font-size: 12px; }
</style>
