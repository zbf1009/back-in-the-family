<script lang="ts">
  import { currentDecision, decisionBusy, type UiState } from '../main/ui-state.ts';
  import { namesById } from '../main/view-model.ts';
  import type { PlayerOption } from '../shared/world-snapshot.ts';
  import type { OperationState } from '../shared/operation-state.ts';
  import { dateLabel, formatAmount, formatMoney } from '../main/calendar.ts';
  import { familyLabel, nameLabel, optionLabel, previewLabel, unitLabel } from '../main/player-copy.ts';
  import OperationDocument from './OperationDocument.svelte';
  const { ui, onChoose, operationStates = [] }: {
    ui: UiState; onChoose: (worldId: number, node: string, option: PlayerOption) => Promise<void>;
    operationStates?: readonly OperationState[];
  } = $props();
  const choice = $derived(currentDecision(ui));
  const names = $derived(ui.world === null ? null : namesById(ui.world));
  function name(person: number): string { return nameLabel(names?.get(person) ?? ui.notebook?.actors.get(person)?.name); }
  const receipts = $derived(operationStates.filter(state => state.kind === 'choose' && state.worldId === ui.worldId));
</script>

<section class="choice-panel" aria-labelledby="choice-heading" data-testid="choice-panel">
  <h2 id="choice-heading">{choice !== null ? familyLabel(choice.family) : 'Your next page'}</h2>
  {#if choice !== null}
    <div class="decision-grid">
      <div class="choice-context">
        <p class="timing">{dateLabel(choice.fired)}</p>
        <h3>The situation</h3>
        <p>{choice.stakes.who.map(name).join(', ')}</p>
        <p>{choice.stakes.unit === 'money' ? formatMoney(choice.stakes.amount) : `${formatAmount(choice.stakes.amount)} ${unitLabel(choice.stakes.unit).toLowerCase()}`}</p>
        <p>Due {dateLabel(choice.stakes.by)}</p>
        <p class="note">Answer day: {dateLabel(choice.choice_tick)}. Resolution day: {dateLabel(choice.resolves)}.</p>
        <p class="default">Default answer: <strong>{optionLabel(choice.rules_default)}</strong></p>
      </div>
      <div class="options">
        <p class="preview-note">Possible effects are a preview, not a result. The life journal reports the actual outcome.</p>
        {#each choice.options as option (option.id)}
          <div class="option" data-testid={`option-preview-${option.id}`}>
            <button type="button" data-testid={`option-${option.id}`} onclick={() => onChoose(ui.worldId, choice.id, option.id)}>{optionLabel(option.id)}</button>
            <ul aria-label={`${optionLabel(option.id)} possible effects`}>
              {#each option.preview as effect, index (index)}
                <li>{name(effect.person)}: {previewLabel(effect.what)} {BigInt(effect.delta) > 0n ? '+' : ''}{formatAmount(effect.delta)}</li>
              {:else}<li class="empty">No numerical changes are listed in this preview.</li>{/each}
            </ul>
          </div>
        {/each}
      </div>
    </div>
  {:else if decisionBusy(ui)}<p class="empty">A decision is being considered.</p>
  {:else}<p class="empty">{ui.world === null ? 'Start a game to meet the town.' : 'No answer is needed right now. Play or take one day to continue.'}</p>{/if}
  {#each receipts as state (`${state.worldId}:${state.requestId}`)}<OperationDocument {state} actors={ui.notebook?.actors} />{/each}
</section>

<style>
  .choice-panel { padding: clamp(18px, 3vw, 28px); min-width: 0; color: var(--life-ink); background: var(--life-paper); font: 15px/1.5 system-ui, sans-serif; container-type: inline-size; border-top: 2px solid var(--life-ink); }
  h2 { margin: 0 0 18px; font: 600 26px/1.25 Georgia, serif; }
  h3 { margin: 18px 0 8px; font-size: 16px; }
  p { overflow-wrap: anywhere; margin: 8px 0; }
  .timing, .choice-context { font-variant-numeric: tabular-nums; }
  .timing { margin-top: 0; }
  .preview-note, .default, .note { color: var(--life-muted); }
  .options { display: flex; flex-direction: column; gap: 18px; }
  .option { border-top: 1px solid var(--life-border); padding-top: 12px; }
  button { max-width: 100%; text-align: left; color: var(--life-on-accent); background: var(--life-accent); border: 1px solid var(--life-accent); font: 600 16px/1.4 system-ui, sans-serif; padding: 10px 16px; overflow-wrap: anywhere; cursor: pointer; }
  button:hover { background: var(--life-ink); }
  button:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  ul { list-style: none; margin: 8px 0 0; padding: 0; }
  li { overflow-wrap: anywhere; margin-bottom: 5px; }
  .empty { color: var(--life-muted); }
  .choice-context, .options { min-width: 0; }
  @container (min-width: 620px) {
    .decision-grid { display: grid; grid-template-columns: minmax(180px, 230px) minmax(0, 1fr); gap: 28px; align-items: start; }
    .preview-note { margin-top: 0; }
  }
</style>
