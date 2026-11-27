<script lang="ts">
  import { onMount, tick } from 'svelte';
  import LifeSurface from '../../src/ui/LifeSurface.svelte';
  import { reduce, type UiState } from '../../src/main/ui-state.ts';
  import { feedbackView } from '../../src/main/view-model.ts';
  import type { Snapshot } from '../../src/shared/protocol.ts';

  const { initialUi }: { initialUi: UiState } = $props();
  // Match App's reactive root and LifeSurface's getter props, not scalar journal props.
  let ui = $state(initialUi);
  const feedback = $derived(feedbackView(ui));
  let transition: Record<string, boolean> | null = null;
  function snapshot(): Snapshot {
    return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum,
      tps: ui.tps, speed: ui.speed, playerNode: ui.playerNode, actions: [], playerLifecycle: [] };
  }
  async function status(patch: Partial<Snapshot>): Promise<void> {
    const previous = ui;
    ui = reduce(ui, { type: 'status', snapshot: { ...snapshot(), ...patch } });
    transition = {
      rootChanged: ui !== previous, worldSame: ui.world === previous.world,
      notebookSame: ui.notebook === previous.notebook, worldKeySame: ui.worldId === previous.worldId,
      soulSame: ui.world?.player_soul === previous.world?.player_soul,
      bodySame: ui.world?.player.body === previous.world?.player.body,
      revisionSame: ui.notebook.renderRevision === previous.notebook.renderRevision,
    };
    await tick();
  }
  function read() {
    return { snapshot: snapshot(), world: $state.snapshot(ui.world),
      renderRevision: ui.notebook.renderRevision, transition };
  }
  function unexpected(): never { throw Error('This journal fixture does not exercise gameplay callbacks'); }
  onMount(() => {
    const evidenceWindow = window as Window & { __journalReactivity?: { read: typeof read; status: typeof status } };
    evidenceWindow.__journalReactivity = { read, status };
    return () => { delete evidenceWindow.__journalReactivity; };
  });
</script>

<main>
  <p>COMPONENT-ONLY — constructed Story carriers, production reducer and LifeSurface. No native gameplay admission.</p>
  <output data-testid="journal-status-tick">{ui.tick}</output>
  <LifeSurface {ui} sprites={null} {feedback} onChoose={unexpected} onForm={unexpected}
    onDream={unexpected} onClaim={unexpected} onBribe={unexpected} onHaunt={unexpected}
    onClose={expected => { ui = reduce(ui, { type: 'scene-close', expected }); }}
    onSettled={expected => { ui = reduce(ui, { type: 'scene-settled', expected }); }} />
</main>
