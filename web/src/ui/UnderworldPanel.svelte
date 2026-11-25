<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { decisionBusy } from '../main/ui-state.ts';
  import type { Slot, TraitName } from '../shared/world-snapshot.ts';
  import { DREAM_INTENTS } from '../shared/protocol.ts';
  import { underworldView } from '../main/view-model.ts';
  import { TRAITS, blankCustomization, customizationPreview, parseBribeAmount, type CustomizationForm, type UnderworldForm } from '../main/customization.ts';
  import { SOUL_COLOR, SOUL_GLYPH } from '../art/sprites.ts';
  const { ui, onForm, onDream, onClaim, onBribe, onHaunt }: {
    ui: UiState; onForm: (form: UnderworldForm) => void; onDream: () => Promise<void>; onClaim: (slot: Slot) => Promise<void>;
    onBribe: (worldId: number, amount: string) => void; onHaunt: (worldId: number, target: number) => void;
  } = $props();
  const view = $derived(underworldView(ui));
  const form = $derived(ui.underworldForm.customization);
  const preview = $derived(ui.world === null ? null : customizationPreview(ui.world, ui.underworldForm));
  type SlotView = NonNullable<ReturnType<typeof underworldView>>['slots'][number];
  let inputWorldId = $state(0);
  let bribeAmount = $state('');
  let hauntSelection = $state<{ worldId: number; target: number } | null>(null);
  const parsedAmount = $derived(parseBribeAmount(bribeAmount));
  const hauntTarget = $derived(view !== null && hauntSelection?.worldId === view.worldId
    ? view.haunt.targets.find(target => target.id === hauntSelection?.target && target.availability.eligible) ?? null : null);
  $effect(() => {
    if (inputWorldId !== ui.worldId) {
      inputWorldId = ui.worldId;
      bribeAmount = '';
      hauntSelection = null;
    }
    if (hauntSelection !== null && hauntTarget === null) hauntSelection = null;
  });
  function bribe(event: SubmitEvent): void {
    event.preventDefault();
    if (view === null || inputWorldId !== view.worldId || !view.bribe.enabled || decisionBusy(ui) || !parsedAmount.ok) return;
    onBribe(view.worldId, parsedAmount.value);
  }
  function haunt(): void {
    if (view === null || hauntTarget === null || !hauntTarget.enabled || decisionBusy(ui)) return;
    onHaunt(view.worldId, hauntTarget.id);
  }
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
      <span><strong>{slot.kind}</strong> · {slot.slot} · {slot.price} joss paper{slot.birth !== null ? ` · birth tick ${slot.birth}` : ''}</span>
      {#if slot.slot === 'rebuilt_body'}
        <button type="button" data-testid="customize" onclick={() => patch({ customization: form === null ? blankCustomization('Set') : null })}>Customize</button>
      {/if}
      {#if slot.slot !== 'rebuilt_body' || form === null}
        <button type="button" data-testid={`claim-${slot.slot}`} aria-label={`Claim ${slot.slot}`} disabled={!slot.claimEnabled || decisionBusy(ui)} onclick={() => onClaim(slot.slot)}>Claim</button>
      {/if}
    </div>
    <div class="path" data-testid={`path-${slot.slot}`}>
      <p>announced {slot.status.announced ? 'yes' : 'no'} · claimable {slot.status.claimable ? 'yes' : 'no'} · affordable {slot.status.affordable ? 'yes' : 'no'}</p>
      {#if slot.needed.length > 0}
        <ul aria-label={`Needed for ${slot.slot}`}>{#each slot.needed as needed, index (index)}<li>{needed}</li>{/each}</ul>
      {/if}
    </div>
  </li>
{/snippet}

{#if view !== null}
  {@const worldId = view.worldId}
  <section class="underworld" aria-labelledby="underworld-heading" data-testid="underworld-panel">
    <div class="header">
      <span class="soul-marker" style:color={SOUL_COLOR} data-testid="underworld-soul-marker" role="img" aria-label="Your soul: gold ring">{SOUL_GLYPH}</span>
      <h2 id="underworld-heading">Underworld</h2>
      <span data-testid="joss-balance">Joss paper: <strong>{view.balance}</strong></span>
    </div>
    <p class="observation" data-testid="underworld-observed-tick">Applied World values as of tick {view.observedTick}. Queued inputs do not reserve or subtract these amounts.</p>
    {#if view.register !== null}
      <div class="register" data-testid="underworld-register">
        <h3>Current register</h3>
        <p>{view.register.name} · ghost {view.register.ghost} · access from tick {view.register.accessFrom}</p>
        <p>Claim: {view.register.claim ?? 'none'} · carried Trait: {view.register.carryOver ?? 'none'}</p>
      </div>
    {/if}
    <p class="cap" data-testid="capped-spend">Shared Haunt / Rebuilt body spend room: {view.cappedSpend.remaining} joss paper · spent {view.cappedSpend.spent} of {view.cappedSpend.yearly_cap} · cap year {view.cappedSpend.cap_year}</p>
    <div class="actions">
      <form class="bribe" data-testid="bribe-controls" onsubmit={bribe}>
        <h3>Bribe</h3>
        <label for="bribe-amount">Amount in joss paper</label>
        <input id="bribe-amount" data-testid="bribe-amount" type="text" inputmode="numeric" autocomplete="off" bind:value={bribeAmount} aria-describedby="bribe-context bribe-syntax" aria-invalid={bribeAmount !== '' && !parsedAmount.ok} />
        <p id="bribe-context">Current minimum: {view.bribe.minAmount} · current maximum: {view.bribe.maxAmount}</p>
        <p id="bribe-syntax" class="note">Canonical decimal u64 only. Zero is valid input syntax; the core may reject it as bad_amount.</p>
        {#if bribeAmount !== '' && !parsedAmount.ok}<p class="error" data-testid="bribe-syntax-error" role="alert">{parsedAmount.error}</p>{/if}
        <p data-testid="bribe-availability">{view.bribe.availability.eligible ? 'Eligible in the applied World.' : `Blocked: ${view.bribe.availability.reason}`}</p>
        {#if !view.controlsAvailable}<p class="note">World controls are unavailable.</p>{/if}
        <button type="submit" data-testid="bribe-send" disabled={!view.bribe.enabled || decisionBusy(ui) || !parsedAmount.ok || inputWorldId !== view.worldId}>Submit bribe</button>
      </form>
      <div class="haunt" data-testid="haunt-controls">
        <h3>Haunt</h3>
        <p>Price: <span data-testid="haunt-price">{view.haunt.price}</span> joss paper. Uses the shared capped-spend room shown above.</p>
        <fieldset>
          <legend>Connected targets</legend>
          <ul data-testid="haunt-targets">
            {#each view.haunt.targets as target (target.id)}
              <li>
                <label class="target">
                  <input type="radio" name="haunt-target" data-testid={`haunt-target-${target.id}`} value={target.id}
                    checked={hauntTarget?.id === target.id} disabled={!target.enabled || decisionBusy(ui)}
                    onchange={() => { hauntSelection = { worldId, target: target.id }; }} />
                  <span>{target.name} · Person {target.id}{target.affinity === null ? '' : ` · ${target.affinity} affinity`}
                    <span class="target-reason">{target.availability.eligible ? 'Eligible in the applied World.' : `Blocked: ${target.availability.reason}`}</span>
                  </span>
                </label>
              </li>
            {:else}<li class="note">No connected targets.</li>{/each}
          </ul>
        </fieldset>
        {#if !view.controlsAvailable}<p class="note">World controls are unavailable.</p>{/if}
        <button type="button" data-testid="haunt-send" disabled={hauntTarget === null || !hauntTarget.enabled || decisionBusy(ui)} onclick={haunt}>Haunt selected target</button>
      </div>
    </div>
    <div class="dream" data-testid="dream-controls">
      <h3>Dream</h3>
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
    {#if form !== null}
      {@const rebuilt = view.slots.find(slot => slot.slot === 'rebuilt_body')!}
      <div class="customization" data-testid="customization-panel">
        <h3>Rebuilt body customization</h3>
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
        <p class="note">{form.kind === 'Set' ? 'Set chooses one Trait and a value from -3 to +3.' : 'Adjust requires two different Traits, each with a change of +1 or -1. Preview values are clamped to -3 through +3.'}</p>
        {#if preview !== null}
          <table data-testid="customization-preview">
            <caption>Customization preview — not applied</caption>
            <thead><tr><th>Trait</th><th>Base</th><th>Customized</th><th>Price</th></tr></thead>
            <tbody>{#each preview.values as row (row.trait)}<tr><th>{row.trait}</th><td>{row.base}</td><td>{row.customized}</td><td>{preview.price}</td></tr>{/each}</tbody>
          </table>
          {#if preview.override !== null}<p data-testid="customization-override">{preview.override}</p>{/if}
        {:else}<p class="note">Choose a complete customization.</p>{/if}
        <button type="button" data-testid="claim-rebuilt_body" aria-label="Claim rebuilt_body" disabled={!rebuilt.claimEnabled || decisionBusy(ui)} onclick={() => onClaim('rebuilt_body')}>Confirm rebuilt claim · {rebuilt.price} joss paper</button>
      </div>
    {/if}
    {#if ui.underworldRecorded !== null}<p class="recorded" data-testid="underworld-recorded" role="status">Queued at tick {ui.underworldRecorded.tick}, not applied yet. Use Run or Step to continue.</p>{/if}
    {#if ui.error !== null}<p class="error" data-testid="underworld-error" role="alert">Rejected: {ui.error}</p>{/if}
  </section>
{/if}

<style>
  .underworld { padding: 16px; min-width: 0; color: var(--life-ink); font: 15px/1.5 system-ui, sans-serif; }
  .header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .soul-marker { font: bold 26px/1 sans-serif; }
  h2 { font-size: 21px; line-height: 1.25; margin: 0; }
  .header > span:last-child { margin-left: auto; overflow-wrap: anywhere; }
  h3 { font-size: 17px; line-height: 1.35; margin: 0 0 12px; }
  p { margin: 8px 0; overflow-wrap: anywhere; }
  .observation { color: var(--life-muted); }
  .register, .dream, .birth-group, .customization { margin-top: 28px; }
  .cap { background: var(--life-secondary); padding: 12px; font-variant-numeric: tabular-nums; }
  .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 24px; margin-top: 24px; }
  .actions > * { min-width: 0; }
  label { display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
  input[type="text"], select { min-width: 0; width: 100%; box-sizing: border-box; font: inherit; padding: 8px; color: var(--life-ink); background: var(--life-paper); border: 1px solid var(--life-muted); }
  input[type="text"] { font-variant-numeric: tabular-nums; }
  button { font: inherit; color: var(--life-ink); background: var(--life-secondary); border: 1px solid var(--life-muted); padding: 8px 12px; line-height: 1.4; max-width: 100%; overflow-wrap: anywhere; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--life-accent); color: var(--life-on-accent); }
  button:disabled { cursor: not-allowed; color: var(--life-muted); background: var(--life-secondary); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  fieldset { min-width: 0; border: 0; margin: 16px 0; padding: 0; }
  legend { font-weight: 600; padding: 0; margin-bottom: 8px; }
  .target { flex-direction: row; align-items: start; gap: 10px; }
  .target input { flex: none; margin-top: 6px; accent-color: var(--life-accent); }
  .target > span { min-width: 0; }
  .target-reason { display: block; color: var(--life-muted); }
  .dream-send { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  .dream-send label { flex: 1 1 220px; min-width: 0; }
  .intents { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .intents button[aria-pressed="true"] { color: var(--life-on-accent); background: var(--life-accent); }
  .carry { margin-top: 24px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .haunt li { margin: 12px 0; }
  .slot-row { padding: 16px 0; border-bottom: 1px solid var(--life-border); }
  .slot-header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .slot-header > span { flex: 1 1 240px; min-width: 0; overflow-wrap: anywhere; }
  .path { margin-top: 8px; font-variant-numeric: tabular-nums; }
  .path li { margin: 4px 0; overflow-wrap: anywhere; }
  .customization { border-top: 1px solid var(--life-border); padding-top: 20px; }
  .form-heading { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; }
  .form-heading label { flex: 1 1 200px; }
  .form-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 16px; margin-top: 16px; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 16px 0; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; vertical-align: top; padding: 8px 8px 8px 0; overflow-wrap: anywhere; }
  .note { color: var(--life-muted); }
  .error { color: var(--life-event); }
  .recorded { margin-top: 20px; }
</style>
