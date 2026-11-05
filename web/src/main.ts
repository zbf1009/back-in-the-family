// Main_Thread entry (R2.2, R6.2, DA-3).
//
// main.ts constructs the one SimClient, wires its worker-initiated events through
// the EventBridge to the App's reducer, mounts the App against #app, and — only
// when the page URL carries `harness=1` — installs the test harness on the SAME
// SimClient (DA-3). The page and the harness therefore share one client, one
// Sim_Worker and one WasmSim (R2.1).

import { mount } from 'svelte';
import App from './App.svelte';
import { SimClient } from './main/sim-client.ts';
import { createBridge } from './main/bridge.ts';
import { installHarness } from './main/harness.ts';

const target = document.getElementById('app');
if (target === null) {
  throw new Error('mount target #app not found');
}

// The bridge lets the App's reducer receive the client's worker-initiated events,
// whose handlers must be set at construction (before the App mounts).
const bridge = createBridge();
const client = new SimClient({
  onStatus: (snapshot) => bridge.dispatch?.({ type: 'status', snapshot }),
  onFatal: (error) => bridge.dispatch?.({ type: 'fatal', error }),
  onError: (error) => bridge.dispatch?.({ type: 'worker-error', error }),
});

const app = mount(App, { target, props: { client, bridge } });

// Install the Smoke_Test hook only when the page URL carries `harness=1`, routing
// through the page's own SimClient so the protocol run and the page controls
// share one worker (DA-3).
if (new URLSearchParams(location.search).get('harness') === '1') {
  installHarness(client);
}

export default app;
