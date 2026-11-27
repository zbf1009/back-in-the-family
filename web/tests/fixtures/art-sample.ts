/// <reference types="vite/client" />
import { mount } from 'svelte';
import ArtSample from './ArtSample.svelte';
const target = document.getElementById('app');
if (target === null) throw new Error('Art sample mount target is missing');
mount(ArtSample, { target });
