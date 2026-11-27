<script lang="ts">
  import { untrack } from 'svelte';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { journalGroupCount, journalMemberLines, journalRange, journalTownPromotion, latestPrimaryIdentity, latestTownEvent, JOURNAL_EXPANSION_SIZE, JOURNAL_RANGE_SIZE, type LifeNotebook } from '../main/life-journal.ts';
  import { TECHNICAL_TEXT, supportedText } from '../main/technical-text.ts';
  import type { StoryEvent } from '../shared/story.ts';
  import ObituaryCard from './ObituaryCard.svelte';
  import type { ObituaryEntry } from '../main/obituary-store.ts';

  const { notebook, playerSoul, currentBody, running, speed, obituaries = [] }: {
    notebook: LifeNotebook;
    playerSoul: string;
    currentBody: number | null;
    running: boolean;
    speed: number;
    obituaries?: readonly ObituaryEntry[];
  } = $props();
  let section = $state<'life' | 'town'>('life');
  let rangeEnd = $state<number | null>(null);
  let expanded = $state<string | null>(null);
  let memberStart = $state(0);
  let promotion = $state<StoryEvent | null>(null);
  let lastPromotedId = $state<string | null>(null);
  let lastPrimaryAt = $state(0);
  const worldKey = $derived(notebook.worldId);
  const renderRevision = $derived(notebook.renderRevision);
  // Clock carriers advance independently; retain prose roots until a factual revision or new World.
  const historicalNotebook = $derived.by(() => {
    worldKey; renderRevision;
    return untrack(() => notebook);
  });
  const soul = $derived(playerSoul);
  const body = $derived(currentBody);
  const context = $derived({ playerSoul: soul, currentBody: body });
  const historyCount = $derived(journalGroupCount(historicalNotebook, section));
  const end = $derived(Math.min(rangeEnd ?? historyCount, historyCount));
  const visible = $derived([...journalRange(historicalNotebook, context, section, end)].reverse());
  const obituariesByLife = $derived(new Map(obituaries.map(entry => [entry.death.lifeKey, entry])));
  const primaryIdentity = $derived(latestPrimaryIdentity(historicalNotebook));
  const promotionText = $derived(promotion ? journalTownPromotion(historicalNotebook, promotion, { ...context, dreams: historicalNotebook.dreams }) : '');

  $effect(() => {
    worldKey;
    section = 'life'; rangeEnd = null; expanded = null; memberStart = 0;
    promotion = null; lastPromotedId = null;
    lastPrimaryAt = performance.now();
  });
  $effect(() => {
    primaryIdentity;
    lastPrimaryAt = performance.now();
    promotion = null;
  });
  $effect(() => {
    if (!running) return;
    worldKey; speed;
    const timer = setInterval(() => {
      if (document.hidden || section !== 'life' || performance.now() - lastPrimaryAt < 5500) return;
      const candidate = untrack(() => latestTownEvent(notebook, lastPromotedId));
      if (candidate === null) return;
      promotion = candidate;
      lastPromotedId = candidate.id;
    }, 5500);
    return () => clearInterval(timer);
  });
  function switchSection(next: 'life' | 'town'): void {
    section = next; rangeEnd = null; expanded = null; memberStart = 0;
  }
  function moveRange(delta: number): void {
    rangeEnd = Math.min(historyCount, Math.max(Math.min(JOURNAL_RANGE_SIZE, historyCount), end + delta));
    if (rangeEnd === historyCount) rangeEnd = null;
    expanded = null; memberStart = 0;
  }
</script>

<section class="notebook" aria-labelledby="life-notebook-heading">
  <header class="notebook-head">
    <h2 id="life-notebook-heading">{section === 'life' ? TECHNICAL_TEXT.journalLife : TECHNICAL_TEXT.journalTown}</h2>
    <div class="sections" role="group" aria-labelledby="life-notebook-heading">
      <button type="button" class:chosen={section === 'life'} aria-pressed={section === 'life'} onclick={() => switchSection('life')}>{TECHNICAL_TEXT.journalLife}</button>
      <button type="button" class:chosen={section === 'town'} aria-pressed={section === 'town'} onclick={() => switchSection('town')}>{TECHNICAL_TEXT.journalTown}</button>
    </div>
  </header>

  {#if section === 'life' && promotion}
    <aside class="town-note" aria-label={TECHNICAL_TEXT.journalTown}>
      <div class="note-heading"><h3>{TECHNICAL_TEXT.journalTown}</h3><span>{dateLabel(promotion.tick)}</span></div>
      <p>{promotionText}</p>
      <button type="button" onclick={() => switchSection('town')}>{TECHNICAL_TEXT.journalTown}</button>
    </aside>
  {/if}

  {#if historyCount > JOURNAL_RANGE_SIZE}
    <nav class="history-range" aria-label={TECHNICAL_TEXT.journalLife}>
      <button type="button" disabled={end <= JOURNAL_RANGE_SIZE} onclick={() => moveRange(-JOURNAL_RANGE_SIZE)}>{TECHNICAL_TEXT.journalEarlier}</button>
      <span>{rangeEnd === null ? TECHNICAL_TEXT.journalLatest : TECHNICAL_TEXT.journalEarlier}</span>
      <button type="button" disabled={end >= historyCount} onclick={() => moveRange(JOURNAL_RANGE_SIZE)}>{TECHNICAL_TEXT.journalLater}</button>
      {#if rangeEnd !== null}<button type="button" onclick={() => { rangeEnd = null; expanded = null; memberStart = 0; }}>{TECHNICAL_TEXT.journalLatest}</button>{/if}
    </nav>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex (溢出区域使用原生键盘滚动。) -->
  <div id="life-journal-accounts" class="accounts" role="region" aria-labelledby="life-notebook-heading" tabindex="0">
    <ol>
      {#each visible as group, index (group.id)}
        <li class:milestone={group.milestone}>
          {#if group.phase && (index === 0 || visible[index - 1]?.phase?.key !== group.phase.key)}
            {@const heading = group.phase.kind === 'waiting' ? TECHNICAL_TEXT.waiting : supportedText(TECHNICAL_TEXT.life, { 'Full Name': group.phase.name ?? undefined })}
            {#if heading}<h3 class="phase-heading">{heading}</h3>{/if}
            {@const obituary = obituariesByLife.get(group.phase.key)}
            {#if obituary !== undefined}<ObituaryCard entry={obituary} />{/if}
          {/if}
          <div class="entry-date">
            <span>{dateLabel(group.from)}{group.to !== group.from ? ` – ${dateLabel(group.to)}` : ''}</span>
            {#if group.opening}<span class="opening">{TECHNICAL_TEXT.journalBefore}</span>{/if}
          </div>
          <p class="account-text">{group.text}</p>
          {#if group.members.length > 1}
            <button class="read-members" type="button" aria-expanded={expanded === group.id} onclick={() => { expanded = expanded === group.id ? null : group.id; memberStart = 0; }}>
              {expanded === group.id ? TECHNICAL_TEXT.journalHide : supportedText(TECHNICAL_TEXT.journalShowAll, { n: formatAmount(String(group.members.length)) })}
            </button>
            {#if expanded === group.id}
              <div class="member-accounts">
                <ol>
                  {#each journalMemberLines(group, historicalNotebook, context, memberStart) as line (line.identity)}
                    <li><span class="member-date">{dateLabel(line.tick)}</span><p>{line.text}</p></li>
                  {/each}
                </ol>
                {#if group.members.length > JOURNAL_EXPANSION_SIZE}
                  <div class="member-navigation" role="group" aria-label={TECHNICAL_TEXT.journalShowAll.replace('{n}', formatAmount(String(group.members.length)))}>
                    <button type="button" disabled={memberStart === 0} onclick={() => { memberStart = Math.max(0, memberStart - JOURNAL_EXPANSION_SIZE); }}>{TECHNICAL_TEXT.journalEarlier}</button>
                    <button type="button" disabled={memberStart + JOURNAL_EXPANSION_SIZE >= group.members.length} onclick={() => { memberStart += JOURNAL_EXPANSION_SIZE; }}>{TECHNICAL_TEXT.journalLater}</button>
                  </div>
                {/if}
              </div>
            {/if}
          {/if}
        </li>
      {:else}
        <li class="empty">{TECHNICAL_TEXT.journalEmpty}</li>
      {/each}
    </ol>
  </div>
</section>

<style>
  .notebook { min-width: 0; color: var(--life-ink, #302b24); background: var(--life-paper, #f5ecd9); padding: 22px clamp(16px, 3vw, 28px); border-top: 1px solid var(--life-border, #b9aa91); font: 16px/1.55 system-ui, sans-serif; }
  .notebook-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 14px 24px; padding-bottom: 12px; border-bottom: 2px solid var(--life-ink, #302b24); }
  h2 { margin: 0; font: 700 26px/1.2 Georgia, serif; }
  h3 { margin: 0; font: 700 17px/1.3 Georgia, serif; }
  .sections { display: flex; gap: 6px; flex-wrap: wrap; }
  button { color: inherit; background: transparent; border: 1px solid transparent; padding: 8px 10px; border-radius: 3px; font: inherit; line-height: 1.25; cursor: pointer; min-height: 40px; }
  button:hover:not(:disabled) { background: #e6dbc5; }
  button:focus-visible, .accounts:focus-visible { outline: 2px solid #805523; outline-offset: 3px; }
  button:disabled { color: #766c5b; cursor: default; }
  .sections .chosen { background: var(--life-ink, #302b24); color: var(--life-paper, #f5ecd9); }
  .sections .chosen:hover { background: #514332; }
  .town-note { padding: 14px 0 16px; border-top: 1px solid var(--life-border, #b9aa91); border-bottom: 1px solid var(--life-border, #b9aa91); margin: 0 0 16px; }
  .note-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 18px; }
  .note-heading span, .entry-date, .member-date { color: var(--life-muted, #665844); font-size: 13px; font-variant-numeric: tabular-nums; }
  .town-note p { margin: 8px 0; max-width: 72ch; }
  .town-note button, .read-members { padding-left: 0; text-decoration: underline; text-underline-offset: 4px; }
  .history-range { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-bottom: 14px; font-size: 14px; }
  .history-range span { color: var(--life-muted, #665844); }
  .accounts { max-height: 560px; overflow: auto; scrollbar-color: #a18b67 #ede2cb; scrollbar-width: thin; padding: 0 8px 0 0; }
  ol { padding: 0; margin: 0; list-style: none; }
  .accounts > ol > li { padding: 17px 0 20px; border-bottom: 1px solid var(--life-border, #b9aa91); overflow-wrap: anywhere; }
  .accounts > ol > li:first-child { padding-top: 0; }
  .entry-date { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .phase-heading { margin: 12px 0 16px; font: 700 21px/1.3 Georgia, serif; }
  .opening { font-style: italic; }
  .account-text { max-width: 72ch; margin: 7px 0 0; }
  .milestone .account-text { font-weight: 560; }
  .member-accounts { margin-top: 12px; padding: 0 0 0 16px; border-left: 1px solid var(--life-border, #b9aa91); }
  .member-accounts li { padding: 10px 0; }
  .member-accounts p { margin: 4px 0 0; max-width: 70ch; }
  .member-navigation { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .empty { color: var(--life-muted, #665844); }
  ::selection { color: #fff8e9; background: #805523; }
  @media (max-width: 640px) { .notebook { padding: 18px 14px; } .notebook-head { gap: 12px; } .accounts { max-height: 480px; } h2 { font-size: 23px; } }
</style>
