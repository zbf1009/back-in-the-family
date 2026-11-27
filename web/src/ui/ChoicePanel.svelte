<script lang="ts">
  import { currentDecision, type UiState } from '../main/ui-state.ts';
  import { namesById } from '../main/view-model.ts';
  import type { PlayerOption } from '../shared/world-snapshot.ts';
  import type { OperationState } from '../shared/operation-state.ts';
  import { formatAmount } from '../main/calendar.ts';
  import { nameLabel, optionLabel, previewLabel } from '../main/player-copy.ts';
  import { TECHNICAL_TEXT, supportedText } from '../main/technical-text.ts';
  import OperationDocument from './OperationDocument.svelte';
  const { ui, onChoose, operationStates = [] }: {
    ui: UiState; onChoose: (worldId: number, node: string, option: PlayerOption) => Promise<void>;
    operationStates?: readonly OperationState[];
  } = $props();
  const choice = $derived(currentDecision(ui));
  const names = $derived(ui.world === null ? null : namesById(ui.world));
  function name(person: number): string { return nameLabel(names?.get(person) ?? ui.notebook?.actors.get(person)?.name); }
  function buttonLabel(option: PlayerOption): string | null {
    if (choice?.family !== 'family_death') return optionLabel(option);
    const mourner = choice.stakes.who[1];
    const actualName = mourner === undefined ? undefined : names?.get(mourner) ?? ui.notebook?.actors.get(mourner)?.name ?? undefined;
    return supportedText(optionLabel(option), { m: actualName });
  }
  const receipts = $derived(operationStates.filter(state => state.kind === 'choose' && state.worldId === ui.worldId));
</script>

<section class="choice-panel" aria-labelledby="choice-heading" data-testid="choice-panel">
  <h2 id="choice-heading">{TECHNICAL_TEXT.choicePrompt}</h2>
  {#if choice !== null}
    <div class="options">
      {#each choice.options as option (option.id)}
        <div class="option" data-testid={`option-preview-${option.id}`}>
          <div class="option-heading">
            <button type="button" data-testid={`option-${option.id}`} onclick={() => onChoose(ui.worldId, choice.id, option.id)}>{buttonLabel(option.id)}</button>
            {#if option.id === choice.rules_default}<span class="default">{TECHNICAL_TEXT.defaultOption}</span>{/if}
          </div>
          <h3>{TECHNICAL_TEXT.preview}</h3>
          <ul aria-label={TECHNICAL_TEXT.preview}>
            {#each option.preview as effect, index (index)}
              <li data-person={effect.person} data-unit={effect.what} data-delta={effect.delta}>{effect.person === ui.world?.player.body ? TECHNICAL_TEXT.previewYou : name(effect.person)}: {previewLabel(effect.what)} {BigInt(effect.delta) >= 0n ? '+' : '−'}{formatAmount(effect.delta).replace(/^-/, '')}</li>
            {:else}<li class="empty">{TECHNICAL_TEXT.noPreview}</li>{/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}
  {#each receipts as state (`${state.worldId}:${state.requestId}`)}<OperationDocument {state} actors={ui.notebook?.actors} />{/each}
</section>

<style>
  .choice-panel { padding: clamp(18px, 3vw, 28px); min-width: 0; color: var(--life-ink); background: var(--life-paper); font: 15px/1.5 system-ui, sans-serif; container-type: inline-size; border-top: 2px solid var(--life-ink); }
  h2 { margin: 0 0 18px; font: 600 26px/1.25 Georgia, serif; }
  h3 { margin: 12px 0 4px; font-size: 14px; }
  .option-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .default { color: var(--life-muted); font-size: 14px; }
  .options { display: flex; flex-direction: column; gap: 18px; }
  .option { border-top: 1px solid var(--life-border); padding-top: 12px; }
  button { max-width: 100%; text-align: left; color: var(--life-on-accent); background: var(--life-accent); border: 1px solid var(--life-accent); font: 600 16px/1.4 system-ui, sans-serif; padding: 10px 16px; overflow-wrap: anywhere; cursor: pointer; }
  button:hover { background: var(--life-ink); }
  button:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  ul { list-style: none; margin: 8px 0 0; padding: 0; }
  li { overflow-wrap: anywhere; margin-bottom: 5px; }
  .empty { color: var(--life-muted); }
</style>
