/// <reference lib="dom" />
/// <reference types="vite/client" />
// Production App + SimClient + LifeSurface; only transport and World geometry are
// controlled. The complete native seed1205 story and kin are not invented here.
import { mount } from 'svelte';
import App from '../../src/App.svelte';
import { SimClient } from '../../src/main/sim-client.ts';
import { createBridge } from '../../src/main/bridge.ts';
import { DEFAULT_SPEED } from '../../src/shared/speeds.ts';
import { livingWorld } from './lifecycle-carriers.ts';
import witnessBytes from './obituary-native.json?raw';
import originalReplayBytes from './obituary-original-bytes.replay.json?raw';
import continuationReplayBytes from '../../../fixtures/parity/seedP-playthrough.replay.json?raw';
import type { Reply, Request as ProtocolRequest, RunUntilStopResult, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import type { StoryBatch } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { OBITUARY_MODEL, OBITUARY_PROMPT_SHA256, OBITUARY_PROMPT_VERSION, type ObituaryRequestV1 } from '../../src/shared/obituary.ts';

const witness = JSON.parse(witnessBytes) as {
  seed: string; completedTicks: string; checksum: string; config: unknown;
  inputs: unknown[]; openingBatch: StoryBatch; observedBatches: RunUntilStopResult[];
  continuation: { seed: string; deathChecksum: string; checksum: string; completedTicks: string;
    openingWorld: WorldSnapshot; deathWorld: WorldSnapshot; finalWorld: WorldSnapshot; afterDeath: RunUntilStopResult[] };
};
const final = witness.observedBatches.find(value => value.story.ownDeathSummaries?.length)!;
const death = final.player_lifecycle.find(value => value.kind === 'death')!;
if (witness.seed !== '1205' || witness.checksum !== '8a1b9da5de15bb91' || death.event !== '2368') throw Error('Missing complete native obituary authority');
if (witness.continuation.seed !== witness.seed || witness.continuation.deathChecksum !== witness.checksum
  || witness.continuation.checksum !== '7bd7c1b9b007eb0f') throw Error('Native continuation does not bind the same run');
// Representation-only normalization matches the existing life-view fixture.
const canonical = (value: string) => /^S-\d+$/.test(value) ? BigInt(value.slice(2)).toString() : value;
function batch(value: StoryBatch): StoryBatch {
  return { ...structuredClone(value), actors: value.actors.map(actor => ({ ...actor, soulId: canonical(actor.soulId) })) };
}
const opening = livingWorld(witness.continuation.openingWorld);
const past = witness.observedBatches.filter(value => value !== final).map(value => batch(value.story));
const beforeDeath: StoryBatch = {
  ...batch(final.story), ownDeathSummaries: undefined,
  // Age-at-death is admitted with the complete death day, not in setup.
  actors: batch(final.story).actors.map(actor => {
    if (actor.person !== death.body) return actor;
    const { ageAtDeath: _age, ...living } = actor; return living;
  }),
  events: final.story.events.filter(event => BigInt(event.tick) < BigInt(death.tick)),
  chronicle: final.story.chronicle.filter(record => BigInt(record.tick) < BigInt(death.tick)),
  cursors: { events: { start: final.story.cursors.events.start, end: String(BigInt(death.event) - 1n) }, chronicle: final.story.cursors.chronicle },
};
const completeDay: StoryBatch = {
  ...batch(final.story),
  events: final.story.events.filter(event => BigInt(event.tick) >= BigInt(death.tick)),
  chronicle: final.story.chronicle.filter(record => BigInt(record.tick) >= BigInt(death.tick)),
};
const initialWorld = { ...opening, tick: death.tick, player_node: null };
const deadWorld = livingWorld(witness.continuation.deathWorld);
const quota = { utc_day: '2026-11-27', reset_at_ms: Date.parse('2026-11-28T00:00:00Z'), daily_limit: 40, daily_remaining: 40, session_limit: 10, session_remaining: 10 };
const search = new URLSearchParams(location.search);
const publicMode = search.get('capability') === 'public';
const mode = search.get('reply') ?? 'pending';
const nativeFetch = window.fetch.bind(window);
const http: { method: string; path: string; body: ObituaryRequestV1 | null }[] = [];
const responses: { resolve(response: Response): void; request: ObituaryRequestV1 }[] = [];
const acceptedText = 'Nadine Bradley, 60, died on Year 15, Day 263. She is survived by her husband, Marvin Jenkins, her son, Marcus Bradley, and her grandsons, Ben Rhodes and Leo Rhodes. She was preceded in death by her husband, Clifford Bradley. Her estate was 229,012 dollars. Two people burned joss on the day she died.';
function providerResponse(request: ObituaryRequestV1, kind: string): Response {
  if (kind === 'provider-error') return Response.json({ version: 1, error: 'provider_error' }, { status: 503 });
  const text = kind === 'invalid' ? '<p>Not an obituary.</p>' : acceptedText;
  return Response.json({ version: 1, operationKey: request.operationKey, quota,
    result: { text, source: 'model', fallbackReason: null, model: OBITUARY_MODEL, promptVersion: OBITUARY_PROMPT_VERSION, promptSha256: OBITUARY_PROMPT_SHA256 } });
}
// All simulated API calls stay in-page. The original fetch is used only for
// same-origin non-API assets; no credentials, provider or external origin exists.
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = init?.method ?? 'GET';
  if (url.origin !== location.origin) throw Error('External request refused by obituary fixture');
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as ObituaryRequestV1 : null;
  http.push({ method, path: url.pathname, body });
  if (url.pathname === '/api/judge/obituary/config' && method === 'GET') return publicMode
    ? new Response(null, { status: 404 })
    : Response.json({ version: 1, enabled: true, model: OBITUARY_MODEL, disabledReason: null, timeout_ms: 10000, quota });
  if (url.pathname !== '/api/obituary' || method !== 'POST' || body === null) throw Error('Unexpected local obituary route');
  if (mode !== 'pending') return providerResponse(body, mode);
  const { promise, resolve } = Promise.withResolvers<Response>();
  responses.push({ resolve, request: body });
  return promise;
};
window.fetch = fakeFetch;
const bridge = createBridge();
const wire = new EventTarget() as EventTarget & { postMessage(request: ProtocolRequest): void; terminate(): void };
const sent: ProtocolRequest[] = [];
const pending = new Map<number, ProtocolRequest>();
let world: WorldSnapshot = initialWorld;
let snapshot: Snapshot = { worldId: 0, runState: 'no-world', tick: null, checksum: null, tps: null,
  speed: DEFAULT_SPEED, playerNode: { pending: false }, actions: [], playerLifecycle: [] };
const emit = (message: WorkerMessage) => wire.dispatchEvent(new MessageEvent('message', { data: structuredClone(message) }));
function currentSnapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return { ...snapshot, actions: [], playerLifecycle: [], story: undefined, stop: undefined, ...patch };
}
wire.postMessage = request => {
  sent.push(request);
  if (request.type === 'decision-status' || request.type === 'world-snapshot' || request.type === 'export-replay') {
    queueMicrotask(() => emit({ type: 'reply', id: request.id, ok: true, snapshot: currentSnapshot(),
      ...(request.type === 'world-snapshot' ? { world } : {}),
      ...(request.type === 'export-replay' ? { replay: replayBytes } : {}) }));
  } else pending.set(request.id, request);
};
wire.terminate = () => {};
let replayBytes = originalReplayBytes;
const harness = {
  read() { return structuredClone({ source: {
    mode: 'PRODUCTION-APP / DETERMINISTIC-TRANSPORT / ACTUAL-NATIVE-FACTS',
    witness: 'web/tests/fixtures/obituary-native.json', checksum: witness.checksum,
    qualification: 'Complete native story/kin and same-run actual WASM death/rebirth Worlds preserved; Soul IDs normalized, opening clock carrier and API/delivery timing controlled. No live Worker/provider run.',
  }, sent, http, snapshot, death, acceptedText, replayBytes }); },
  create(id: number, success = true) {
    const request = pending.get(id);
    if (request?.type !== 'create-world') throw Error('Missing Create ticket');
    pending.delete(id);
    if (!success) { emit({ type: 'reply', id, ok: false, kind: 'sim-error', error: 'Controlled Create rejection', snapshot: currentSnapshot() }); return; }
    world = structuredClone(initialWorld);
    replayBytes = originalReplayBytes;
    snapshot = currentSnapshot({ worldId: snapshot.worldId + 1, tick: world.tick, checksum: witness.checksum, runState: 'paused' });
    emit({ type: 'reply', id, ok: true, world, snapshot: { ...snapshot,
      story: [witness.openingBatch, ...past, beforeDeath].map(value => ({ worldId: snapshot.worldId, batch: batch(value) })) } });
  },
  death(withSummary = true) {
    world = structuredClone(deadWorld);
    snapshot = currentSnapshot({ tick: world.tick, runState: 'paused' });
    const value = structuredClone(completeDay);
    if (!withSummary) delete value.ownDeathSummaries;
    emit({ type: 'status', snapshot: { ...snapshot, stop: { reasons: ['player_died'], world },
      playerLifecycle: [death], story: [{ worldId: snapshot.worldId, batch: value }] } });
  },
  summaryFirst() {
    world = structuredClone(deadWorld);
    snapshot = currentSnapshot({ tick: world.tick, runState: 'paused' });
    emit({ type: 'status', snapshot: { ...snapshot, story: [{ worldId: snapshot.worldId, batch: completeDay }] } });
  },
  lifecycleAfterSummary() {
    emit({ type: 'status', snapshot: { ...currentSnapshot(), stop: { reasons: ['player_died'], world }, playerLifecycle: [death] } });
  },
  redeliver() { this.death(); },
  rebirth() {
    world = livingWorld(witness.continuation.finalWorld);
    snapshot = currentSnapshot({ tick: world.tick, checksum: witness.continuation.checksum, runState: 'paused' });
    replayBytes = continuationReplayBytes;
    emit({ type: 'status', snapshot: { ...snapshot, stop: { reasons: ['dream_resolved', 'player_reborn'], world },
      playerLifecycle: witness.continuation.afterDeath.flatMap(value => value.player_lifecycle),
      story: witness.continuation.afterDeath.map(value => ({ worldId: snapshot.worldId, batch: batch(value.story) })) } });
  },
  resolve(kind = 'accepted', index = 0) {
    const response = responses[index];
    if (!response) throw Error('Missing pending obituary response');
    response.resolve(providerResponse(response.request, kind));
  },
  reply(id: number) {
    const request = pending.get(id);
    if (!request) throw Error('Missing gameplay ticket');
    pending.delete(id);
    snapshot = currentSnapshot({ ...(request.type === 'run' ? { runState: 'running' } : {}),
      ...(request.type === 'set-speed' ? { speed: request.speed } : {}) });
    const message: Reply = { type: 'reply', id, ok: true, snapshot,
      ...(['bribe', 'haunt', 'dream', 'claim'].includes(request.type) ? { submission: { tick: snapshot.tick!, seqs: ['3'] } } : {}) };
    emit(message);
  },
  oldStatus(worldId: number) { emit({ type: 'status', snapshot: { ...currentSnapshot(), worldId, stop: { reasons: ['player_died'], world: deadWorld }, playerLifecycle: [death], story: [{ worldId, batch: completeDay }] } }); },
};
declare global { interface Window { __obituaryFixture: typeof harness } }
window.__obituaryFixture = harness;
const client = new SimClient({ onStatus: value => bridge.dispatch?.({ type: 'status', snapshot: value }),
  onFatal: error => bridge.dispatch?.({ type: 'fatal', error }), onError: error => bridge.dispatch?.({ type: 'worker-error', error }) }, wire as unknown as Worker);
mount(App, { target: document.getElementById('fixture')!, props: { client, bridge } });
