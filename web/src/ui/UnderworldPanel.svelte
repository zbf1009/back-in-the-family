<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { decisionBusy } from '../main/ui-state.ts';
  import type { Slot, TraitName } from '../shared/world-snapshot.ts';
  import { DREAM_INTENTS } from '../shared/protocol.ts';
  import { namesById, underworldView } from '../main/view-model.ts';
  import { TRAITS, blankCustomization, customizationPreview, parseBribeAmount, type CustomizationForm, type UnderworldForm } from '../main/customization.ts';
  import type { OperationState } from '../shared/operation-state.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { CUSTOMIZATION_LABELS, dreamIntentLabel, dreamResponseLabel, nameLabel, neededText, originLabel, refusalText, rulingLabel, traitLabel } from '../main/player-copy.ts';
  import { TECHNICAL_TEXT, supportedText } from '../main/technical-text.ts';
  import PeopleCard from './PeopleCard.svelte';
  import TargetCard from './TargetCard.svelte';
  import ActionFeedback from './ActionFeedback.svelte';
  import type { SpriteSet } from '../art/sprites.ts';
  const { ui, sprites = null, onForm, onDream, onClaim, onBribe, onHaunt, operationStates = [] }: {
    ui: UiState; sprites?: SpriteSet | null; onForm: (form: UnderworldForm) => void; onDream: () => Promise<void>; onClaim: (slot: Slot) => Promise<void>;
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
  function dream(): void {
    if (view === null || !view.dreamEnabled || decisionBusy(ui) || !view.connected.some(person => person.id === ui.underworldForm.dreamer)) return;
    void onDream();
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
  const residents = $derived.by(() => {
    const result = new Map<number, NonNullable<UiState['world']>['residents'][number]>();
    if (ui.world !== null) for (const person of ui.world.residents) result.set(person.id, person);
    return result;
  });
  function actualName(person: number): string | undefined { return names?.get(person) ?? ui.notebook?.actors.get(person)?.name ?? undefined; }
  function name(person: number): string { return nameLabel(names?.get(person) ?? ui.notebook?.actors.get(person)?.name); }
  function age(person: number): number | null {
    const resident = residents.get(person);
    if (resident !== undefined) return resident.age;
    const recorded = ui.notebook.actors.get(person)?.ageAtDeath;
    return recorded !== undefined && BigInt(recorded) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(recorded) : null;
  }
  function sex(person: number): 'female' | 'male' | undefined {
    return residents.get(person)?.sex ?? ui.notebook.actors.get(person)?.sex;
  }
  function family(slot: Slot): string {
    const birth = ui.world?.birth_slots.find(birth => `birth:${birth.id}` === slot);
    const household = ui.world?.households.find(home => home.id === birth?.household);
    return household?.members.map(name).join(', ') ?? '';
  }
  const baseTraits = $derived(ui.world?.underworld_view?.base_traits.find(entry => entry.carry_over === ui.underworldForm.carryOver)?.traits);
  function proposed(traitName: TraitName): number | undefined { return preview?.values.find(row => row.trait === traitName)?.customized ?? baseTraits?.[traitName]; }
</script>

{#snippet slotRow(slot: SlotView)}
  <li class="slot-row" data-testid={`slot-${slot.slot}`}>
    <div class="slot-header">
      <div>
        <strong id={`slot-name-${slot.slot}`}>{slot.kind === 'birth_slot' ? family(slot.slot) : originLabel(slot.slot)}</strong>
        <p data-price={slot.price}>{formatAmount(slot.price)} joss paper{slot.birth !== null ? ` · ${dateLabel(slot.birth)}` : ''}</p>
      </div>
      {#if slot.slot === 'rebuilt_body'}
        <button type="button" data-testid="customize" onclick={() => patch({ customization: form === null ? blankCustomization('Set') : null })}>{form === null ? TECHNICAL_TEXT.adjustPersonality : TECHNICAL_TEXT.cancelAdjustment}</button>
      {/if}
      {#if slot.slot !== 'rebuilt_body' || form === null}
        <button type="button" id={`apply-${slot.slot}`} data-testid={`claim-${slot.slot}`} aria-labelledby={`apply-${slot.slot} slot-name-${slot.slot}`} aria-describedby={`slot-details-${slot.slot}`} disabled={!slot.claimEnabled || decisionBusy(ui)} onclick={() => onClaim(slot.slot)}>{TECHNICAL_TEXT.apply}</button>
      {/if}
    </div>
    <div id={`slot-details-${slot.slot}`}>
      {#if !slot.status.announced}<p class="path">{TECHNICAL_TEXT.pathUnannounced}</p>{/if}
      {#if !slot.status.claimable}<p class="path">{TECHNICAL_TEXT.pathNotClaimable}</p>{/if}
      {#if slot.status.needed.length > 0}<ul class="needed" aria-label="Application requirements">{#each slot.status.needed as needed, index (index)}<li data-needed-kind={needed.kind} data-needed-name={needed.kind === 'named' ? needed.name : undefined} data-amount={needed.kind === 'joss_short' || needed.kind === 'cap_room_short' ? needed.amount : undefined} data-tick={needed.kind === 'wait_until' ? needed.tick : undefined}>{neededText(needed)}</li>{/each}</ul>{/if}
    </div>
  </li>
{/snippet}

{#if view !== null}
  {@const worldId = view.worldId}
  <section class="underworld" aria-labelledby="underworld-heading" data-testid="underworld-panel">
    <header class="desk-heading"><h2 id="underworld-heading">{TECHNICAL_TEXT.desk}</h2><p>{TECHNICAL_TEXT.deskServing}</p></header>
    <div class="desk-records">
      <article class="certificate" aria-labelledby="certificate-heading">
        <h3 id="certificate-heading">{TECHNICAL_TEXT.certificate}</h3>
        {#if ghost !== undefined}<PeopleCard person={ghost} name={name(ghost)} age={age(ghost)} sex={actor?.sex} {sprites} current />{/if}
        <dl>
          {#if ghost !== undefined}<div><dt>{TECHNICAL_TEXT.certificateName}</dt><dd>{name(ghost)}</dd></div>{/if}
          {#if deceased !== undefined}<div><dt>{TECHNICAL_TEXT.dateOfDeath}</dt><dd>{dateLabel(deceased.death)}</dd></div>{/if}
          {#if actor?.ageAtDeath !== undefined}<div><dt>{TECHNICAL_TEXT.certificateAge}</dt><dd>{formatAmount(actor.ageAtDeath)}</dd></div>{/if}
        </dl>
        <p class="clerk-note">{TECHNICAL_TEXT.certificateFooter}</p>
      </article>
      <div class="accounts">
        <h3>{TECHNICAL_TEXT.account}</h3>
        <p data-testid="joss-balance" data-amount={view.balance}>{supportedText(TECHNICAL_TEXT.accountBalance, { n: formatAmount(view.balance) })}</p>
        <p data-testid="capped-spend" data-remaining={view.cappedSpend.remaining} data-cap={view.cappedSpend.yearly_cap}>{supportedText(TECHNICAL_TEXT.accountAllowance, { left: formatAmount(view.cappedSpend.remaining), cap: formatAmount(view.cappedSpend.yearly_cap) })}</p>
        <p class="note">{TECHNICAL_TEXT.accountAllowanceNote}</p>
        {#if view.register !== null}
          <p>{supportedText(TECHNICAL_TEXT.accountRegister, { date: dateLabel(view.register.accessFrom) })}</p>
          <p>{view.register.claim === null ? TECHNICAL_TEXT.accountHoldingNothing : supportedText(TECHNICAL_TEXT.accountHolding, { slot: family(`birth:${view.register.claim}`) || undefined })}</p>
          <p>{view.register.carryOver === null ? TECHNICAL_TEXT.accountCarryingNothing : supportedText(TECHNICAL_TEXT.accountCarrying, { trait: traitLabel(view.register.carryOver) })}</p>
        {/if}
      </div>
    </div>

    <div class="desk-actions">
      <details class="dream-message" data-testid="dream-section">
        <summary><h3>{TECHNICAL_TEXT.dream}</h3></summary>
        <div class="section-body" data-testid="dream-controls">
          <p class="gloss">{TECHNICAL_TEXT.dreamHelp}</p>
          <fieldset><legend>{TECHNICAL_TEXT.dreamTo}</legend>
            <ul class="target-files" data-testid="dream-targets">
              {#each view.connected as person (person.id)}
                <li><TargetCard person={person.id} name={name(person.id)} age={age(person.id)} sex={sex(person.id)} {sprites} group="dream"
                  selected={ui.underworldForm.dreamer === person.id} disabled={!view.controlsAvailable || decisionBusy(ui)} onSelect={() => patch({ dreamer: person.id })} /></li>
              {:else}<li class="note">{TECHNICAL_TEXT.dreamNobody}</li>{/each}
            </ul>
          </fieldset>
          <fieldset><legend>{TECHNICAL_TEXT.dreamIntent}</legend><div class="intents">
            {#each DREAM_INTENTS as intent (intent)}<button type="button" data-testid={`dream-intent-${intent}`} aria-pressed={ui.underworldForm.intent === intent} onclick={() => patch({ intent })}>{dreamIntentLabel(intent)}</button>{/each}
          </div></fieldset>
          <p data-testid="dream-price" data-amount={view.dreamPrice}>{supportedText(TECHNICAL_TEXT.dreamPostage, { n: formatAmount(view.dreamPrice) })}</p>
          {#if BigInt(view.balance) < BigInt(view.dreamPrice)}<p class="note">{refusalText('insufficient_joss')}</p>{/if}
          <button class="primary" type="button" data-testid="dream-send" disabled={!view.dreamEnabled || decisionBusy(ui) || !view.connected.some(person => person.id === ui.underworldForm.dreamer)} onclick={dream}>{TECHNICAL_TEXT.dreamSend}</button>
          {#if ui.world?.last_dream !== undefined}
            {@const response = supportedText(dreamResponseLabel(ui.world.last_dream.applied), { B: actualName(ui.world.last_dream.dreamer) })}
            {#if response !== null}<div class="recorded-response"><p>{response}</p></div>{/if}
          {/if}
        </div>
      </details>

      <details class="bribe-receipt" data-testid="bribe-section">
        <summary><h3>{TECHNICAL_TEXT.magistrate}</h3></summary>
        <form class="section-body" data-testid="bribe-controls" onsubmit={bribe}>
          <p class="gloss">{TECHNICAL_TEXT.magistrateHelp}</p>
          <label for="bribe-amount">{TECHNICAL_TEXT.contribution}</label>
          <input id="bribe-amount" data-testid="bribe-amount" type="text" inputmode="numeric" autocomplete="off" bind:value={bribeAmount} aria-describedby="bribe-context bribe-syntax" aria-invalid={bribeAmount !== '' && !parsedAmount.ok} />
          <p id="bribe-context">{supportedText(TECHNICAL_TEXT.contributionHint, { min: formatAmount(view.bribe.minAmount), max: formatAmount(view.bribe.maxAmount) })}</p>
          <p id="bribe-syntax" class="note" class:error={bribeAmount !== '' && !parsedAmount.ok}>{bribeAmount !== '' && !parsedAmount.ok ? parsedAmount.error : TECHNICAL_TEXT.contributionBadInput}</p>
          {#if !view.bribe.availability.eligible}<p data-testid="bribe-availability">{refusalText(view.bribe.availability.reason)}</p>{/if}
          <button class="primary" type="submit" data-testid="bribe-send" disabled={!view.bribe.enabled || decisionBusy(ui) || !parsedAmount.ok || inputWorldId !== view.worldId}>Contribute</button>
          {#each operationStates.filter(state => state.kind === 'bribe') as state (state.requestId)}
            {#if state.result?.kind === 'bribe' && state.result.state === 'applied' && state.result.ruling !== null}<p>{rulingLabel(state.result.ruling.applied)}</p>{/if}
          {/each}
          {#if !operationStates.some(state => state.result?.kind === 'bribe' && state.result.state === 'applied' && state.result.ruling !== null)}<p class="unruled">{TECHNICAL_TEXT.noRuling}</p>{/if}
        </form>
      </details>

      <details class="haunt-petition" data-testid="haunt-section">
        <summary><h3>{TECHNICAL_TEXT.haunt}</h3></summary>
        <div class="section-body" data-testid="haunt-controls">
          <p class="gloss">{TECHNICAL_TEXT.hauntHelp}</p>
          <p data-testid="haunt-price" data-amount={view.haunt.price}>{supportedText(TECHNICAL_TEXT.hauntFee, { n: formatAmount(view.haunt.price) })}</p>
          <fieldset><legend>{TECHNICAL_TEXT.hauntTarget}</legend>
            <ul class="target-files" data-testid="haunt-targets">
              {#each view.haunt.targets as target (target.id)}
                <li><TargetCard person={target.id} name={name(target.id)} age={age(target.id)} sex={sex(target.id)} {sprites} group="haunt"
                  selected={hauntTarget?.id === target.id} disabled={!target.enabled || decisionBusy(ui)}
                  reason={target.availability.eligible ? null : refusalText(target.availability.reason)}
                  onSelect={() => { hauntSelection = { worldId, target: target.id }; }} /></li>
              {:else}<li class="note">{TECHNICAL_TEXT.hauntNobody}</li>{/each}
            </ul>
          </fieldset>
          <button class="primary" type="button" data-testid="haunt-send" disabled={hauntTarget === null || !hauntTarget.enabled || decisionBusy(ui)} onclick={haunt}>Haunt</button>
        </div>
      </details>

      <details class="personality-file" data-testid="carry-section">
        <summary><h3>{TECHNICAL_TEXT.carry}</h3></summary>
        <div class="section-body">
          <p class="gloss">{TECHNICAL_TEXT.carryHelp}</p>
          <label class="carry">{TECHNICAL_TEXT.adjustmentTrait}
            <select data-testid="carry-over" value={ui.underworldForm.carryOver ?? ''} onchange={event => patch({ carryOver: trait(event) })}>
              <option value="">{TECHNICAL_TEXT.carryNone}</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}: {view.ghostTraits[name]}</option>{/each}
            </select>
          </label>
          <dl class="trait-file">{#each TRAITS as name (name)}<div><dt>{traitLabel(name)}</dt><dd>{view.ghostTraits[name]}</dd></div>{/each}</dl>
        </div>
      </details>

      <details class="applications" data-testid="rebirth-section">
        <summary><h3>{TECHNICAL_TEXT.rebirth}</h3></summary>
        <div class="section-body">
          <p class="gloss">{TECHNICAL_TEXT.rebirthHelp}</p>
          <section class="birth-application" aria-labelledby="birth-heading"><h4 id="birth-heading">{TECHNICAL_TEXT.beBorn}</h4>
            <p>{TECHNICAL_TEXT.beBornHelp}</p>
            <ul class="birth-slots" data-testid="birth-slots" aria-label="Birth openings">{#each view.slots.filter(slot => slot.kind === 'birth_slot') as slot (slot.slot)}{@render slotRow(slot)}{:else}<li class="note">{TECHNICAL_TEXT.noBirthFamilies}</li>{/each}</ul>
          </section>
          <div class="standing-applications">
            {#each view.slots.filter(slot => slot.kind !== 'birth_slot') as slot (slot.slot)}
              <section class="standing-application" class:rebuilt={slot.slot === 'rebuilt_body'} aria-label={originLabel(slot.slot)}>
                <h4>{originLabel(slot.slot)}</h4><p class="gloss">{slot.slot === 'rebuilt_body' ? TECHNICAL_TEXT.buildBodyHelp : TECHNICAL_TEXT.borrowBodyHelp}</p>
                <ul>{@render slotRow(slot)}</ul>
              </section>
            {/each}
          </div>
        </div>
      </details>
    </div>

    {#if form !== null}
      {@const rebuilt = view.slots.find(slot => slot.slot === 'rebuilt_body')!}
      <section class="customization" aria-labelledby="customization-heading" data-testid="customization-panel">
        <h3 id="customization-heading">{TECHNICAL_TEXT.buildBody}</h3>
        <div class="form-heading">
          <label>Kind of adjustment <select data-testid="customization-kind" value={form.kind} onchange={event => patch({ customization: blankCustomization(selected(event) as 'Set' | 'Adjust') })}><option value="Set">{CUSTOMIZATION_LABELS.Set}</option><option value="Adjust">{CUSTOMIZATION_LABELS.Adjust}</option></select></label>
          <button type="button" data-testid="customization-cancel" onclick={() => patch({ customization: null })}>Never mind</button>
        </div>
        {#if form.kind === 'Set'}
          <div class="form-fields">
            <label>Trait <select data-testid="customization-trait" value={form.trait ?? ''} onchange={event => setPatch({ trait: trait(event) })}><option value="">Pick a trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}</option>{/each}</select></label>
            <label>Set to <select data-testid="customization-value" value={form.value ?? ''} onchange={event => setPatch({ value: selected(event) === '' ? null : Number(selected(event)) })}><option value="">Pick a value</option>{#each [-3, -2, -1, 0, 1, 2, 3] as value (value)}<option value={value}>{value}</option>{/each}</select></label>
          </div>
        {:else}
          <div class="form-fields adjust">
            <label>First trait <select data-testid="customization-first" value={form.first ?? ''} onchange={event => adjustPatch({ first: trait(event) })}><option value="">Pick a trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}</option>{/each}</select></label>
            <label>Up or down <select data-testid="customization-first-delta" value={form.firstDelta ?? ''} onchange={event => adjustPatch({ firstDelta: delta(event) })}><option value="">Pick</option><option value={1}>+1</option><option value={-1}>-1</option></select></label>
            <label>Second trait <select data-testid="customization-second" value={form.second ?? ''} onchange={event => adjustPatch({ second: trait(event) })}><option value="">Pick a different trait</option>{#each TRAITS as name (name)}<option value={name}>{traitLabel(name)}</option>{/each}</select></label>
            <label>Up or down <select data-testid="customization-second-delta" value={form.secondDelta ?? ''} onchange={event => adjustPatch({ secondDelta: delta(event) })}><option value="">Pick</option><option value={1}>+1</option><option value={-1}>-1</option></select></label>
          </div>
        {/if}
        <table data-testid="customization-preview"><thead><tr><th>Trait</th><th>Now</th><th>As ordered</th></tr></thead>
          <tbody>{#each TRAITS as name (name)}<tr data-trait={name}><th>{traitLabel(name)}</th><td>{baseTraits?.[name] ?? ''}</td><td>{proposed(name) ?? ''}</td></tr>{/each}</tbody>
        </table>
        <p data-testid="customization-price" data-amount={rebuilt.price}><strong>{formatAmount(rebuilt.price)}</strong> joss paper</p>
        {#if preview?.override !== null && preview?.override !== undefined && ui.underworldForm.carryOver !== null}<p data-testid="customization-override">{supportedText(TECHNICAL_TEXT.adjustmentOverride, { trait: traitLabel(ui.underworldForm.carryOver) })}</p>{/if}
        {#if preview === null}<p class="note">{TECHNICAL_TEXT.adjustmentIncomplete}</p>{/if}
        <button class="primary" type="button" data-testid="claim-rebuilt_body" disabled={!rebuilt.claimEnabled || decisionBusy(ui)} onclick={() => onClaim('rebuilt_body')}>{TECHNICAL_TEXT.confirmOrder}</button>
      </section>
    {/if}
    <ActionFeedback operationStates={operationStates.filter(state => state.kind !== 'choose')} actors={ui.notebook?.actors} />
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
  .desk-actions { margin-top: 24px; }
  .desk-actions > details { border-top: 1px solid var(--life-border); }
  summary { padding: 14px 0; cursor: pointer; }
  summary h3 { display: inline; margin: 0; font-size: 20px; }
  summary:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  .section-body { padding: 0 0 20px; }
  .unruled { margin-top: 20px; padding-top: 12px; border-top: 1px dashed var(--life-border); }
  .target-files { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 8px; }
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
  .carry { max-width: 420px; }
  .trait-file { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 0 28px; }
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
  th, td { text-align: left; padding: 9px 4px; overflow-wrap: anywhere; border-bottom: 1px solid var(--life-border); }
  .gloss, .note { color: var(--life-muted); }
  .error { color: var(--life-event); }
  ::selection { background: var(--life-accent); color: var(--life-on-accent); }
  @container (min-width: 640px) {
    .desk-records { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
    .standing-applications { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
