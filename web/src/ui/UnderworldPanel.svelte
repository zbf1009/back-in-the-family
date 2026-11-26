<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { decisionBusy } from '../main/ui-state.ts';
  import type { Slot, TraitName } from '../shared/world-snapshot.ts';
  import { DREAM_INTENTS } from '../shared/protocol.ts';
  import { namesById, underworldView } from '../main/view-model.ts';
  import { TRAITS, blankCustomization, customizationPreview, parseBribeAmount, type CustomizationForm, type UnderworldForm } from '../main/customization.ts';
  import type { OperationState } from '../shared/operation-state.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { CUSTOMIZATION_LABELS, dreamIntentLabel, dreamResponseLabel, nameLabel, neededText, originLabel, refusalText, traitLabel } from '../main/player-copy.ts';
  import PeopleCard from './PeopleCard.svelte';
  import OperationDocument from './OperationDocument.svelte';
  const { ui, onForm, onDream, onClaim, onBribe, onHaunt, operationStates = [] }: {
    ui: UiState; onForm: (form: UnderworldForm) => void; onDream: () => Promise<void>; onClaim: (slot: Slot) => Promise<void>;
    onBribe: (worldId: number, amount: string) => void; onHaunt: (worldId: number, target: number) => void;
    operationStates?: readonly OperationState[];
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
  const ghost = $derived(ui.world?.player_wait?.ghost);
  const deceased = $derived(ui.world?.player.earlier_bodies.find(body => body.id === ghost));
  const actor = $derived(ghost === undefined ? undefined : ui.notebook?.actors.get(ghost));
  const names = $derived(ui.world === null ? null : namesById(ui.world));
  function name(person: number): string { return nameLabel(names?.get(person) ?? ui.notebook?.actors.get(person)?.name); }
  function age(person: number): number | null { return ui.world?.residents.find(resident => resident.id === person)?.age ?? null; }
  function receipts(kind: OperationState['kind']): readonly OperationState[] { return operationStates.filter(state => state.worldId === ui.worldId && state.kind === kind); }
  function family(slot: Slot): string {
    const birth = ui.world?.birth_slots.find(birth => `birth:${birth.id}` === slot);
    const household = ui.world?.households.find(home => home.id === birth?.household);
    return household === undefined ? 'Family names unavailable' : household.members.map(name).join(', ') || 'Family names unavailable';
  }
  const baseTraits = $derived(ui.world?.underworld_view?.base_traits.find(entry => entry.carry_over === ui.underworldForm.carryOver)?.traits);
  function proposed(traitName: TraitName): number | undefined { return preview?.values.find(row => row.trait === traitName)?.customized ?? baseTraits?.[traitName]; }
</script>

{#snippet slotRow(slot: SlotView)}
  <li class="slot-row" data-testid={`slot-${slot.slot}`}>
    <div class="slot-header">
      <div>
        <strong>{slot.kind === 'birth_slot' ? family(slot.slot) : originLabel(slot.slot)}</strong>
        <p>{formatAmount(slot.price)} joss paper{slot.birth !== null ? ` · Birth ${dateLabel(slot.birth)}` : ''}</p>
      </div>
      {#if slot.slot === 'rebuilt_body'}
        <button type="button" data-testid="customize" onclick={() => patch({ customization: form === null ? blankCustomization('Set') : null })}>{form === null ? 'Open personality amendments' : 'Close amendments'}</button>
      {/if}
      {#if slot.slot !== 'rebuilt_body' || form === null}
        <button type="button" data-testid={`claim-${slot.slot}`} aria-label={slot.kind === 'birth_slot' ? `Apply for birth with ${family(slot.slot)}${slot.birth !== null ? ` on ${dateLabel(slot.birth)}` : ''}` : `Apply to ${originLabel(slot.slot).toLowerCase()}`} disabled={!slot.claimEnabled || decisionBusy(ui)} onclick={() => onClaim(slot.slot)}>Apply</button>
      {/if}
    </div>
    <p class="path">{slot.status.announced ? 'Announced' : 'Not announced'} · {slot.status.claimable ? 'Open to applications' : 'Not open to applications'} · {slot.status.affordable ? 'Payment available' : 'Payment unavailable'}</p>
    {#if slot.status.needed.length > 0}<ul class="needed" aria-label="Application requirements">{#each slot.status.needed as needed, index (index)}<li>{neededText(needed)}</li>{/each}</ul>{/if}
  </li>
{/snippet}

{#if view !== null}
  {@const worldId = view.worldId}
  <section class="underworld" aria-labelledby="underworld-heading" data-testid="underworld-panel">
    <header class="desk-heading"><h2 id="underworld-heading">The Underworld desk</h2><p>Current · {dateLabel(view.observedTick)}</p></header>
    <div class="desk-records">
      <article class="certificate" aria-labelledby="certificate-heading">
        <h3 id="certificate-heading">Death certificate</h3>
        {#if ghost !== undefined}<PeopleCard person={ghost} name={name(ghost)} detail="Former life" current />{:else}<p>Name unavailable</p>{/if}
        <dl>
          {#if deceased !== undefined}<div><dt>Date of death</dt><dd>{dateLabel(deceased.death)}</dd></div>{/if}
          {#if actor?.ageAtDeath !== undefined}<div><dt>Age at death</dt><dd>{formatAmount(actor.ageAtDeath)}</dd></div>{/if}
          <div><dt>Current status</dt><dd>Waiting between lives</dd></div>
        </dl>
        <p class="clerk-note">A change of address. The paperwork continues.</p>
      </article>
      <div class="accounts">
        <h3>Your current account</h3>
        <dl><div><dt>Joss paper</dt><dd data-testid="joss-balance">{formatAmount(view.balance)}</dd></div>
          <div><dt>This year's allowance remaining</dt><dd>{formatAmount(view.cappedSpend.remaining)}</dd></div>
          <div><dt>Spent from this year's allowance</dt><dd>{formatAmount(view.cappedSpend.spent)} of {formatAmount(view.cappedSpend.yearly_cap)}</dd></div>
        </dl>
        <p class="note">Haunting and rebuilt bodies use this allowance. These are current amounts, not deductions from a received request.</p>
        {#if view.register !== null}
          <p>Birth-register access from {dateLabel(view.register.accessFrom)}.</p>
          <p>Current reservation: {view.register.claim === null ? 'None' : family(`birth:${view.register.claim}`)}.</p>
          <p>Personality carry on file: {view.register.carryOver === null ? 'None' : traitLabel(view.register.carryOver)}.</p>
        {/if}
      </div>
    </div>

    <div class="correspondence">
      <section class="dream-message" aria-labelledby="dream-heading" data-testid="dream-controls">
        <h3 id="dream-heading">A message in a dream</h3>
        <p class="gloss">Choose a living connection and what you want to convey. Their response is their own record.</p>
        <label>Recipient <select data-testid="dreamer" value={ui.underworldForm.dreamer ?? ''} onchange={event => patch({ dreamer: selected(event) === '' ? null : Number(selected(event)) })}>
          <option value="">Choose a recipient</option>{#each view.connected as person (person.id)}<option value={person.id}>{name(person.id)}</option>{/each}
        </select></label>
        {#if ui.underworldForm.dreamer !== null && view.connected.some(person => person.id === ui.underworldForm.dreamer)}
          <PeopleCard person={ui.underworldForm.dreamer} name={name(ui.underworldForm.dreamer)} age={age(ui.underworldForm.dreamer)} detail="Dream recipient" />
        {/if}
        <div class="intents" role="group" aria-label="Message intent">
          {#each DREAM_INTENTS as intent (intent)}<button type="button" data-testid={`dream-intent-${intent}`} aria-pressed={ui.underworldForm.intent === intent} onclick={() => patch({ intent })}>{dreamIntentLabel(intent)}</button>{/each}
        </div>
        <p>Price: <strong data-testid="dream-price">{formatAmount(view.dreamPrice)}</strong> joss paper.</p>
        {#each view.dreamReasons as reason (reason)}<p class="note">{reason}</p>{/each}
        <button class="primary" type="button" data-testid="dream-send" disabled={!view.dreamEnabled || decisionBusy(ui) || ui.underworldForm.dreamer === null} onclick={onDream}>Send dream message</button>
        {#each receipts('dream') as state (state.requestId)}<OperationDocument {state} actors={ui.notebook?.actors} />{/each}
        {#if ui.world?.last_dream !== undefined}
          <div class="recorded-response"><h4>Latest recorded response</h4><p>{name(ui.world.last_dream.dreamer)} · {dateLabel(ui.world.last_dream.tick)}</p>
            <p>{dreamResponseLabel(ui.world.last_dream.applied)}</p><p class="note">This response does not confirm effects or the completion of an individual request.</p>
          </div>
        {/if}
      </section>

      <form class="bribe-receipt" aria-labelledby="bribe-heading" data-testid="bribe-controls" onsubmit={bribe}>
        <h3 id="bribe-heading">Bribe receipt</h3>
        <p class="gloss">Request a ruling on birth-register access. Access is not a reservation.</p>
        <label for="bribe-amount">Payment in joss paper</label>
        <input id="bribe-amount" data-testid="bribe-amount" type="text" inputmode="numeric" autocomplete="off" bind:value={bribeAmount} aria-describedby="bribe-context bribe-syntax" aria-invalid={bribeAmount !== '' && !parsedAmount.ok} />
        <p id="bribe-context">Minimum {formatAmount(view.bribe.minAmount)} · maximum {formatAmount(view.bribe.maxAmount)}.</p>
        <p id="bribe-syntax" class="note">Use whole digits without spaces, signs or leading zeros. Payment must be above zero.</p>
        {#if bribeAmount !== '' && !parsedAmount.ok}<p class="error" data-testid="bribe-syntax-error" role="alert">Enter a whole amount within the supported range, using digits only and no leading zeros.</p>{/if}
        <p data-testid="bribe-availability">{view.bribe.availability.eligible ? 'Available to file.' : refusalText(view.bribe.availability.reason)}</p>
        {#if !view.controlsAvailable}<p class="note">These actions are unavailable right now.</p>{/if}
        <button class="primary" type="submit" data-testid="bribe-send" disabled={!view.bribe.enabled || decisionBusy(ui) || !parsedAmount.ok || inputWorldId !== view.worldId}>Submit bribe</button>
        {#each receipts('bribe') as state (state.requestId)}<OperationDocument {state} actors={ui.notebook?.actors} />{:else}<p class="unruled">No ruling recorded.</p>{/each}
      </form>
    </div>

    <section class="haunt-petition" aria-labelledby="haunt-heading" data-testid="haunt-controls">
      <div class="petition-heading"><h3 id="haunt-heading">Haunt petition</h3><p>Price: <strong data-testid="haunt-price">{formatAmount(view.haunt.price)}</strong> joss paper</p></div>
      <p class="gloss">A connection to your former life is required—not necessarily a friendly one. The yearly allowance applies.</p>
      <fieldset><legend>Choose a connected person</legend>
        <ul class="target-files" data-testid="haunt-targets">
          {#each view.haunt.targets as target (target.id)}
            <li><label class="target"><input type="radio" name="haunt-target" data-testid={`haunt-target-${target.id}`} value={target.id} checked={hauntTarget?.id === target.id} disabled={!target.enabled || decisionBusy(ui)} onchange={() => { hauntSelection = { worldId, target: target.id }; }} />
              <div><PeopleCard person={target.id} name={name(target.id)} age={age(target.id)} relationship={target.affinity} />
                <span class="target-reason">{target.availability.eligible ? 'Available to file.' : refusalText(target.availability.reason)}</span>
              </div></label></li>
          {:else}<li class="note">No connected people are available.</li>{/each}
        </ul>
      </fieldset>
      {#if !view.controlsAvailable}<p class="note">These actions are unavailable right now.</p>{/if}
      <button class="primary" type="button" data-testid="haunt-send" disabled={hauntTarget === null || !hauntTarget.enabled || decisionBusy(ui)} onclick={haunt}>File haunt petition</button>
      {#each receipts('haunt') as state (state.requestId)}<OperationDocument {state} actors={ui.notebook?.actors} />{/each}
    </section>

    <section class="personality-file" aria-labelledby="personality-heading">
      <h3 id="personality-heading">Your personality file</h3>
      <p class="gloss">Carry one trait into your next life, or leave them all behind. These are selections, not a completed rebirth.</p>
      <label class="carry">Trait to carry
        <select data-testid="carry-over" value={ui.underworldForm.carryOver ?? ''} onchange={event => patch({ carryOver: trait(event) })}>
          <option value="">None — carry no trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}: {view.ghostTraits[name]}</option>{/each}
        </select>
      </label>
      <dl class="trait-file">{#each TRAITS as name (name)}<div><dt>{traitLabel(name)}</dt><dd>{view.ghostTraits[name]}</dd></div>{/each}</dl>
      {#each receipts('carry-over') as state (state.requestId)}<OperationDocument {state} actors={ui.notebook?.actors} />{/each}
    </section>

    <section class="applications" aria-labelledby="applications-heading">
      <h3 id="applications-heading">Applications for another life</h3>
      <p class="gloss">Three ways back into this town. An application is not an arrival.</p>
      <section class="birth-application" aria-labelledby="birth-heading"><h4 id="birth-heading">Be born into a family</h4>
        <p data-testid="birth-slot-count">{view.slots.filter(slot => slot.kind === 'birth_slot').length} birth openings on the register.</p>
        <ul class="birth-slots" data-testid="birth-slots" aria-label="Birth openings">{#each view.slots.filter(slot => slot.kind === 'birth_slot') as slot (slot.slot)}{@render slotRow(slot)}{:else}<li class="note">No birth openings are listed.</li>{/each}</ul>
      </section>
      <div class="standing-applications">
        {#each view.slots.filter(slot => slot.kind !== 'birth_slot') as slot (slot.slot)}
          <section class="standing-application" class:rebuilt={slot.slot === 'rebuilt_body'} aria-label={originLabel(slot.slot)}>
            <h4>{originLabel(slot.slot)}</h4><p class="gloss">{slot.slot === 'rebuilt_body' ? 'A new body, with a paid personality amendment.' : 'Return in an available borrowed body. This is not a birth.'}</p>
            <ul>{@render slotRow(slot)}</ul>
          </section>
        {/each}
      </div>
      {#each receipts('claim') as state (state.requestId)}<OperationDocument {state} actors={ui.notebook?.actors} />{/each}
    </section>

    {#if form !== null}
      {@const rebuilt = view.slots.find(slot => slot.slot === 'rebuilt_body')!}
      <section class="customization" aria-labelledby="customization-heading" data-testid="customization-panel">
        <h3 id="customization-heading">Rebuilt-body personality amendments</h3>
        <div class="form-heading">
          <label>Amendment <select data-testid="customization-kind" value={form.kind} onchange={event => patch({ customization: blankCustomization(selected(event) as 'Set' | 'Adjust') })}><option value="Set">{CUSTOMIZATION_LABELS.Set}</option><option value="Adjust">{CUSTOMIZATION_LABELS.Adjust}</option></select></label>
          <button type="button" data-testid="customization-cancel" onclick={() => patch({ customization: null })}>Cancel amendment</button>
        </div>
        {#if form.kind === 'Set'}
          <div class="form-fields">
            <label>Trait <select data-testid="customization-trait" value={form.trait ?? ''} onchange={event => setPatch({ trait: trait(event) })}><option value="">Choose a trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}</option>{/each}</select></label>
            <label>Proposed value <select data-testid="customization-value" value={form.value ?? ''} onchange={event => setPatch({ value: selected(event) === '' ? null : Number(selected(event)) })}><option value="">Choose a value</option>{#each [-3, -2, -1, 0, 1, 2, 3] as value (value)}<option value={value}>{value}</option>{/each}</select></label>
          </div>
        {:else}
          <div class="form-fields adjust">
            <label>First trait <select data-testid="customization-first" value={form.first ?? ''} onchange={event => adjustPatch({ first: trait(event) })}><option value="">Choose a trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}</option>{/each}</select></label>
            <label>First change <select data-testid="customization-first-delta" value={form.firstDelta ?? ''} onchange={event => adjustPatch({ firstDelta: delta(event) })}><option value="">Choose</option><option value={1}>+1</option><option value={-1}>-1</option></select></label>
            <label>Second trait <select data-testid="customization-second" value={form.second ?? ''} onchange={event => adjustPatch({ second: trait(event) })}><option value="">Choose a different trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}</option>{/each}</select></label>
            <label>Second change <select data-testid="customization-second-delta" value={form.secondDelta ?? ''} onchange={event => adjustPatch({ secondDelta: delta(event) })}><option value="">Choose</option><option value={1}>+1</option><option value={-1}>-1</option></select></label>
          </div>
        {/if}
        <p class="note">{form.kind === 'Set' ? 'Set one trait to a value from −3 to +3.' : 'Choose two different traits, each with a change of +1 or −1. Values stay within −3 to +3.'}</p>
        <table data-testid="customization-preview"><caption>Proposed personality — not applied</caption><thead><tr><th>Trait</th><th>Base</th><th>Proposed</th></tr></thead>
          <tbody>{#each TRAITS as name (name)}<tr><th>{traitLabel(name)}</th><td>{baseTraits?.[name] ?? 'Unavailable'}</td><td>{proposed(name) ?? 'Unavailable'}</td></tr>{/each}</tbody>
        </table>
        <p>Path price: <strong>{formatAmount(rebuilt.price)}</strong> joss paper.</p>
        {#if preview?.override !== null && preview?.override !== undefined && ui.underworldForm.carryOver !== null}<p data-testid="customization-override">This amendment replaces the carried {traitLabel(ui.underworldForm.carryOver)} value.</p>{/if}
        {#if preview === null}<p class="note">Complete the amendment before applying.</p>{/if}
        <button class="primary" type="button" data-testid="claim-rebuilt_body" aria-label="Confirm rebuilt-body application" disabled={!rebuilt.claimEnabled || decisionBusy(ui)} onclick={() => onClaim('rebuilt_body')}>Confirm rebuilt-body application</button>
      </section>
    {/if}
    {#if ui.error !== null}<p class="error" data-testid="underworld-error" role="alert">{refusalText(ui.error)}</p>{/if}
  </section>
{/if}

<style>
  .underworld { padding: clamp(18px, 3vw, 30px); min-width: 0; color: var(--life-ink); background: var(--life-secondary); font: 15px/1.5 system-ui, sans-serif; container-type: inline-size; }
  .desk-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 24px; }
  h2 { font: 600 30px/1.2 Georgia, serif; margin: 0; }
  h3 { font: 600 23px/1.25 Georgia, serif; margin: 0 0 14px; }
  h4 { font-size: 18px; margin: 0 0 10px; }
  p { margin: 9px 0; max-width: 65ch; overflow-wrap: anywhere; }
  .desk-heading p { margin: 0; }
  .desk-records { display: grid; gap: 24px; }
  .certificate { padding: 22px; background: var(--life-paper); border: 2px solid var(--life-ink); }
  .certificate h3 { text-align: center; border-bottom: 1px solid var(--life-border); padding-bottom: 14px; }
  .accounts { padding: 12px 0; }
  dl { margin: 18px 0; font-variant-numeric: tabular-nums; }
  dl > div { display: flex; gap: 16px; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--life-border); }
  dt, dd { margin: 0; overflow-wrap: anywhere; }
  dd { font-weight: 600; text-align: right; }
  .clerk-note { font: italic 15px/1.5 Georgia, serif; }
  .correspondence { display: grid; gap: 24px; margin-top: 30px; align-items: start; }
  .dream-message { background: var(--life-paper); padding: 24px; border-top: 2px solid var(--life-accent); }
  .bribe-receipt { padding: 24px; background: var(--life-paper); border-top: 1px dashed var(--life-ink); border-bottom: 1px dashed var(--life-ink); }
  .unruled { margin-top: 20px; padding-top: 12px; border-top: 1px dashed var(--life-border); }
  .haunt-petition { margin-top: 32px; padding-top: 22px; border-top: 2px solid var(--life-ink); }
  .petition-heading { display: flex; gap: 12px; justify-content: space-between; flex-wrap: wrap; align-items: baseline; }
  .target-files { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); column-gap: 24px; }
  .target { display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 8px 0 14px; cursor: pointer; }
  .target > div { min-width: 0; }
  .target input { flex: none; accent-color: var(--life-accent); width: 18px; height: 18px; }
  .target-reason { display: block; color: var(--life-muted); font-size: 13px; }
  label { display: flex; flex-direction: column; gap: 7px; overflow-wrap: anywhere; }
  input[type="text"], select { min-width: 0; width: 100%; box-sizing: border-box; font: inherit; padding: 10px; color: var(--life-ink); background: var(--life-paper); border: 1px solid var(--life-muted); caret-color: var(--life-accent); }
  button { font: 600 14px/1.4 system-ui, sans-serif; color: var(--life-ink); background: var(--life-paper); border: 1px solid var(--life-muted); padding: 10px 14px; max-width: 100%; overflow-wrap: anywhere; cursor: pointer; }
  button.primary, .intents button[aria-pressed="true"] { color: var(--life-on-accent); background: var(--life-accent); border-color: var(--life-accent); }
  button:hover:not(:disabled) { color: var(--life-on-accent); background: var(--life-ink); }
  button:disabled { cursor: not-allowed; color: var(--life-muted); background: var(--life-secondary); border-color: var(--life-border); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  fieldset { min-width: 0; border: 0; margin: 18px 0; padding: 0; }
  legend { font-weight: 600; margin-bottom: 10px; }
  .intents { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
  .recorded-response { margin-top: 24px; border-top: 1px solid var(--life-border); padding-top: 16px; }
  .recorded-response h4 { font-size: 15px; }
  .personality-file { margin-top: 34px; padding-top: 22px; border-top: 1px solid var(--life-ink); }
  .carry { max-width: 420px; }
  .trait-file { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 0 28px; }
  .applications { margin-top: 34px; padding-top: 22px; border-top: 2px solid var(--life-ink); }
  .birth-application { margin-top: 22px; background: var(--life-paper); padding: 24px; }
  .standing-applications { display: grid; gap: 22px; margin-top: 22px; }
  .standing-application { padding: 22px; border: 1px solid var(--life-muted); }
  .standing-application.rebuilt { background: var(--life-paper); border-style: dashed; }
  ul { list-style: none; margin: 0; padding: 0; }
  .slot-row { padding: 16px 0; border-bottom: 1px solid var(--life-border); }
  .slot-header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .slot-header > div { flex: 1 1 200px; min-width: 0; }
  .slot-header strong { overflow-wrap: anywhere; }
  .path, .needed { font-size: 13px; }
  .needed li { margin: 6px 0; overflow-wrap: anywhere; }
  .customization { margin-top: 28px; padding: 24px; border-top: 2px solid var(--life-accent); background: var(--life-paper); }
  .form-heading { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; }
  .form-heading label { flex: 1 1 220px; }
  .form-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 16px; margin: 20px 0; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 20px 0; font-variant-numeric: tabular-nums; }
  caption { text-align: left; margin-bottom: 10px; font-weight: 600; }
  th, td { text-align: left; padding: 9px 4px; overflow-wrap: anywhere; border-bottom: 1px solid var(--life-border); }
  .gloss, .note { color: var(--life-muted); }
  .error { color: var(--life-event); }
  ::selection { background: var(--life-accent); color: var(--life-on-accent); }
  @container (min-width: 640px) {
    .desk-records { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
    .correspondence { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }
    .standing-applications { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
