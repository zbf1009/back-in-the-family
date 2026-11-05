import { mount } from 'svelte';
import App from './App.svelte';

// Placeholder entry. Task 3.7 wires the app to the Sim_Worker client and
// installs the harness when location.search contains harness=1.
const target = document.getElementById('app');
if (target === null) {
  throw new Error('mount target #app not found');
}
const app = mount(App, { target });

export default app;
