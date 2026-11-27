/// <reference lib="dom" />
/// <reference types="vite/client" />
import { mount } from 'svelte';
import baselineBytes from '../../../fixtures/parity/seed1-pairwise.snapshot-500.json?raw';
import LifecycleFixture from './LifecycleFixture.svelte';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import '../../src/ui/life.css';

const target = document.getElementById('fixture');
if (target === null) throw Error('Lifecycle component fixture mount target is missing');
mount(LifecycleFixture, { target, props: { baseline: JSON.parse(baselineBytes) as WorldSnapshot } });
