<script lang="ts">
  // The web shell page (R3.1-R3.3, R4.4, R4.7-R4.10, R5.1, R5.8, R9.11).
  //
  // App.svelte holds one UiState in a rune, feeds every SimClient event and user
  // action through the pure `reduce`, and renders the status fields, controls and
  // message areas from it. It owns no simulation and no worker: the SimClient is
  // constructed in main.ts and passed in as a prop, so the same client (and the
  // same Sim_Worker) is shared with the test harness (DA-3). It touches the
  // simulation only by calling SimClient methods, which send Worker_Protocol
  // messages (R2.2, R6.2).
  //
  // The page keeps the shell controls and renders town, identity, choices and
  // Chronicle from reducer-owned World Snapshots. Choices submit one option;
  // only the existing Run and Step controls advance the simulation (R10.10).
  //
  // Note: the reactive state variable is named `ui`, not `state`. A variable named
  // `state` collides with the `$state` rune call (`$state(...)` reads as a store
  // auto-subscription when a `state` binding is in scope).

  import type { SimClient, ReplyMessage } from './main/sim-client.ts';
  import type { EventBridge } from './main/bridge.ts';
  import type { Request } from './shared/protocol.ts';
  import {
    initialUiState,
    reduce,
    controls,
    formatTick,
    formatChecksum,
    formatTps,
    formatRunState,
    type UiEvent,
    type UiState,
  } from './main/ui-state.ts';
  import { parseSeed } from './shared/seed.ts';
  import { SPEEDS } from './shared/speeds.ts';
  import type { PlayerOption } from './shared/world-snapshot.ts';
  import TownView from './ui/TownView.svelte';
  import IdentityPanel from './ui/IdentityPanel.svelte';
  import ChoicePanel from './ui/ChoicePanel.svelte';
  import ChroniclePanel from './ui/ChroniclePanel.svelte';
  // World_Config field is prefilled with text identical to the fixture file
  // (R3.1). Vite's `?raw` import yields the file's bytes verbatim, so the textarea
  // starts equal to fixtures/configs/pairwise.json. The path is relative to this
  // file at web/src/App.svelte: up to web/src, up to web, up to the repo root,
  // then into fixtures/configs.
  import pairwiseConfig from '../../fixtures/configs/pairwise.json?raw';

  const { client, bridge }: { client: SimClient; bridge: EventBridge } = $props();

  // The single source of truth the page renders. Every event folds into it via
  // `reduce`; the control enablement and formatted fields derive from it.
  let ui: UiState = $state(initialUiState());

  // The editable fields. The seed starts empty; the config starts as the fixture.
  let seed = $state('');
  let config = $state(pairwiseConfig);

  // Worker Snapshot.playerNode disables Run/Step until an accepted choice;
  // the Worker enforces the same gate even for direct harness requests.
  const buttons = $derived(controls(ui));

  // Fold one event into the state. Assigning a fresh object keeps the rune reactive.
  function dispatch(event: UiEvent): void {
    ui = reduce(ui, event);
    // Create replies carry no World. Read it once after creation; between stops
    // the town keeps that latest World, with no polling or clock on the page.
    if (event.type === 'reply' && event.message.ok && event.request.type === 'create-world') {
      void refreshWorld();
    }
  }

  async function refreshWorld(): Promise<void> {
    const worldId = ui.worldId;
    const request: Request = { type: 'world-snapshot', id: 0 };
    const reply = await client.request({ type: 'world-snapshot' });
    if (ui.worldId === worldId) settle(request, reply);
  }

  async function onChoose(node: string, option: PlayerOption): Promise<void> {
    const request: Request = { type: 'choose', id: 0, node, option };
    dispatch({ type: 'request-sent', request });
    settle(request, await client.request({ type: 'choose', node, option }));
  }

  // The SimClient's worker-initiated events (status, fatal, worker error) were
  // registered on the client at construction in main.ts to forward through this
  // bridge. Point the bridge at this component's reducer while it is mounted, so a
  // `status`, `fatal` or `worker-error` becomes a UiEvent (R2.8, R2.9, R2.12).
  $effect(() => {
    bridge.dispatch = dispatch;
    return () => {
      bridge.dispatch = null;
    };
  });

  // Create: validate the seed on the Main_Thread first. An invalid seed shows the
  // validation message and sends nothing (R3.3); a valid one marks the request
  // sent (clears the seed message, disables Create) and calls createWorld with the
  // seed string exactly as entered and the config text unchanged (R3.2).
  async function onCreate(): Promise<void> {
    const result = parseSeed(seed);
    if (!result.ok) {
      dispatch({ type: 'seed-invalid', problem: result.problem });
      return;
    }
    const request: Request = { type: 'create-world', id: 0, seed, config };
    dispatch({ type: 'request-sent', request });
    settle(request, await client.createWorld({ seed, config }));
  }

  async function onRun(): Promise<void> {
    const request: Request = { type: 'run', id: 0 };
    dispatch({ type: 'request-sent', request });
    settle(request, await client.run());
  }

  async function onPause(): Promise<void> {
    const request: Request = { type: 'pause', id: 0 };
    dispatch({ type: 'request-sent', request });
    settle(request, await client.pause());
  }

  // Step disables itself through `controls` (stepPending) until the reply arrives (R4.10).
  async function onStep(): Promise<void> {
    const request: Request = { type: 'step', id: 0 };
    dispatch({ type: 'request-sent', request });
    settle(request, await client.step());
  }

  // Speed is a selection from the fixed SPEEDS list (R4.4); the select offers no
  // other value. Changing it sends a set-speed request.
  async function onSpeedChange(event: Event): Promise<void> {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    const request: Request = { type: 'set-speed', id: 0, speed: value };
    dispatch({ type: 'request-sent', request });
    settle(request, await client.setSpeed({ speed: value }));
  }

  // Feed a reply back through the reducer, carrying the originating request so the
  // reducer clears the matching pending flag (create/step) (R3.8, R4.10).
  function settle(request: Request, message: ReplyMessage): void {
    dispatch({ type: 'reply', request, message });
  }
</script>

<main>
  <h1>Back in the Family</h1>
  <div class="play-layout">
    <aside class="left-column">
      <IdentityPanel {ui} />
      <ChroniclePanel {ui} />
    </aside>
    <div class="centre-column">


  <section class="controls">
    <button type="button" data-testid="create" disabled={!buttons.create} onclick={onCreate}>
      Create
    </button>
    <button type="button" data-testid="run" disabled={!buttons.run} onclick={onRun}>Run</button>
    <button type="button" data-testid="pause" disabled={!buttons.pause} onclick={onPause}>
      Pause
    </button>
    <button type="button" data-testid="step" disabled={!buttons.step} onclick={onStep}>Step</button>

    <label>
      Speed
      <select data-testid="speed" value={ui.speed} onchange={onSpeedChange}>
        {#each SPEEDS as speed (speed)}
          <option value={speed}>{speed}</option>
        {/each}
      </select>
    </label>
  </section>

  <TownView {ui} />

  <section class="status">
    <div>
      <span class="label">Tick</span>
      <span data-testid="tick">{formatTick(ui)}</span>
    </div>
    <div>
      <span class="label">Checksum</span>
      <span data-testid="checksum">{formatChecksum(ui)}</span>
    </div>
    <div>
      <span class="label">Run_State</span>
      <span data-testid="run-state">{formatRunState(ui)}</span>
    </div>
    <div>
      <span class="label">Ticks_Per_Second</span>
      <span data-testid="tps">{formatTps(ui)}</span>
    </div>
  </section>
  <section class="inputs">
    <label>
      Seed
      <input
        type="text"
        inputmode="numeric"
        data-testid="seed"
        bind:value={seed}
        placeholder="0 to 18446744073709551615"
      />
    </label>

    <label>
      World_Config
      <textarea data-testid="config" rows="4" bind:value={config}></textarea>
    </label>

    {#if ui.seedMessage !== null}
      <p class="seed-message" data-testid="seed-message">{ui.seedMessage}</p>
    {/if}
  </section>

  {#if ui.error !== null}
    <p class="error" data-testid="error">{ui.error}</p>
  {:else}
    <p class="error" data-testid="error"></p>
  {/if}
    </div>
    <aside class="right-column">
      <ChoicePanel {ui} onChoose={onChoose} />
    </aside>
  </div>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f8f7f2; color: #252525; font-family: system-ui, sans-serif; font-size: 14px; }
  :global(::selection) { background: #d7d2bd; color: #111111; }
  :global(:focus-visible) { outline: 2px solid #252525; outline-offset: 3px; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; color: inherit; border: 1px solid #858585; border-radius: 4px; background: #fffefa; }
  :global(button) { cursor: pointer; padding: 6px 10px; }
  :global(button:hover:not(:disabled)) { background: #e2e0d9; }
  :global(button:disabled) { color: #65645e; background: #eeede6; cursor: not-allowed; }
  :global(input), :global(textarea), :global(select) { padding: 5px 7px; caret-color: #252525; }
  :global([role="region"]) { scrollbar-color: #858585 #eeede6; scrollbar-width: thin; }
  main { max-width: 1280px; margin: 0 auto; }
  h1 { margin: 0; height: 40px; padding: 8px 16px; font-size: 20px; line-height: 24px; border-bottom: 1px solid #c6c3b9; }
  .play-layout { display: grid; grid-template-columns: 300px 620px 360px; }
  .left-column { display: grid; grid-template-rows: 390px 290px; min-height: 0; border-right: 1px solid #c6c3b9; }
  .centre-column { min-width: 0; }
  .right-column { border-left: 1px solid #c6c3b9; }
  .controls { height: 40px; display: flex; align-items: center; gap: 8px; padding: 3px 12px; }
  .controls label { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .status { padding: 12px 16px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .label { color: #54534f; margin-right: 8px; }
  .inputs { display: flex; flex-wrap: wrap; align-items: start; gap: 12px; padding: 10px 16px 0; font-size: 12px; }
  .inputs label { display: flex; flex-direction: column; gap: 5px; }
  .inputs input { width: 245px; }
  .inputs textarea { width: 290px; height: 55px; resize: vertical; }
  .seed-message, .error { color: #9b2520; }
  .seed-message { margin: 0; }
  .error { margin: 8px 16px; font-size: 12px; overflow-wrap: anywhere; }
  .error:empty { margin: 0; }
  @media (max-width: 1279px) {
    .play-layout { grid-template-columns: minmax(240px, 300px) minmax(0, 620px); }
    .right-column { grid-column: 1 / -1; border-top: 1px solid #c6c3b9; }
  }
  @media (max-width: 720px) {
    .play-layout { display: flex; flex-direction: column; }
    .centre-column { order: -1; border: 0; }
    .left-column { grid-template-rows: 340px 240px; }
    .inputs textarea { max-width: 100%; }
  }
</style>
