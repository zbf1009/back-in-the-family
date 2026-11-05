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
  // The page is a shell only: a seed field, a World_Config field, Create / Run /
  // Pause / Step, a Speed selector and the four status fields. There is no control
  // for submitting inputs, running replays or verifying against native (R9.11);
  // the Smoke_Test reaches those paths through the harness, not the page.
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

  const buttons = $derived(controls(ui));

  // Fold one event into the state. Assigning a fresh object keeps the rune reactive.
  function dispatch(event: UiEvent): void {
    ui = reduce(ui, event);
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
  <h1>Back in the Family — web shell</h1>

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

  {#if ui.error !== null}
    <p class="error" data-testid="error">{ui.error}</p>
  {:else}
    <p class="error" data-testid="error"></p>
  {/if}
</main>
