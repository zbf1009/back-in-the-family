/// <reference lib="dom" />
/// <reference types="vite/client" />
import { mount } from 'svelte';
import HiddenBundleFixture from './HiddenBundleFixture.svelte';
import '../../src/ui/life.css';

const target = document.getElementById('fixture');
if (target === null) throw Error('Hidden bundle fixture mount target is missing');
mount(HiddenBundleFixture, { target });
