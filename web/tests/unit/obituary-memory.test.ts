import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fetchObituaryCapability, startObituaryAttempt, type ObituaryCapabilityState, type ObituaryTransport } from '../../src/main/obituary-client.ts';
import { ObituaryRun, type ObituaryDeath, type ObituaryEntry } from '../../src/main/obituary-store.ts';
import { exportObituarySidecar } from '../../src/main/obituary-export.ts';
import { renderObituaryTemplate } from '../../src/main/obituary-template.ts';
import type { FallbackReason, ObituaryCapabilityV1, ObituaryFactsV1, ObituaryReplyV1, ObituaryResultV1 } from '../../src/shared/obituary.ts';

const positive: { facts: ObituaryFactsV1; paragraph: string } = JSON.parse(readFileSync(new URL('../fixtures/obituary-seed1205-positive.json', import.meta.url), 'utf8'));
const replayBytes = readFileSync(new URL('../../../fixtures/parity/seedP-playthrough.replay.json', import.meta.url), 'utf8');
const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
const prompt = 'You write obituaries for the local paper of a small American town where the dead are reborn into the same town. Write one obituary of 40 to 110 words from the facts given. Dry, affectionate, deadpan; the humor is in what you choose to mention and how plainly you say it. Use only the facts given. Never state or imply a cause of death, a job, a hobby, a place, a feeling, or a quote. Do not address the reader. Do not mention reincarnation except, at most, one closing line noting the deceased is not expected to stay away long. Plain text, one paragraph, no title.';
const provenance = { promptVersion: 'obituary.author.v2', promptSha256: 'bcfd04e1d158dafc7f8361c442cee0ab41f177c74e02f549e6f69b3518a491fb' };
const nativeTemplate = renderObituaryTemplate(positive.facts);
const quota = { utc_day: '2026-11-27', reset_at_ms: Date.parse('2026-11-28T00:00:00.000Z'), daily_limit: 40 as const, daily_remaining: 39, session_limit: 10 as const, session_remaining: 9 };
const enabled: ObituaryCapabilityState = { capability: { version: 1, enabled: true, model, disabledReason: null, timeout_ms: 10000, quota }, reason: null };
const publicCapability: ObituaryCapabilityState = { capability: null, reason: 'public' };

interface FetchCall { url: string; init: RequestInit }

/** Instance-local logical clock: all handles are browser-contract numbers. */
class MemoryTransport implements ObituaryTransport {
  readonly calls: FetchCall[] = [];
  readonly requested = Promise.withResolvers<void>();
  readonly timerStarted = Promise.withResolvers<void>();
  #time = 0;
  #nextHandle = 1;
  #timers = new Map<number, { due: number; callback: () => void }>();
  readonly fetch: typeof fetch;

  constructor(respond: (call: FetchCall) => Response | Promise<Response>) {
    this.fetch = async (input, init) => {
      const call = { url: String(input), init: init ?? {} };
      this.calls.push(call);
      this.requested.resolve();
      return await respond(call);
    };
  }
  now(): number { return this.#time; }
  setTimeout(callback: () => void, milliseconds: number): number {
    const handle = this.#nextHandle++;
    this.#timers.set(handle, { due: this.#time + milliseconds, callback });
    this.timerStarted.resolve();
    return handle;
  }
  clearTimeout(handle: number): void { this.#timers.delete(handle); }
  get timerCount(): number { return this.#timers.size; }
  elapse(milliseconds: number): void { this.#time += milliseconds; }
  advance(milliseconds: number): void {
    this.elapse(milliseconds);
    for (;;) {
      const next = [...this.#timers].filter(([, timer]) => timer.due <= this.#time)
        .sort(([a, left], [b, right]) => left.due - right.due || a - b)[0];
      if (next === undefined) return;
      this.#timers.delete(next[0]);
      next[1].callback();
    }
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function freshFacts(): ObituaryFactsV1 { return structuredClone(positive.facts); }
function sha256(bytes: string): string { return createHash('sha256').update(bytes, 'utf8').digest('hex'); }
function operationKey(run: ObituaryRun, entry: ObituaryEntry): string { return sha256(`${run.runId}\0${entry.death.eventId}`); }
function admitted(worldId = 7, facts = freshFacts()): { run: ObituaryRun; entry: ObituaryEntry } {
  const run = new ObituaryRun(worldId);
  const entry = run.admit({ eventId: '2368', personId: 10, tick: '5372', lifeKey: `${worldId}/life/10` }, facts);
  assert.ok(entry);
  return { run, entry };
}
function generated(text = positive.paragraph): ObituaryResultV1 {
  return { text, source: 'model', fallbackReason: null, model, ...provenance };
}
function template(reason: FallbackReason, attemptedModel: typeof model | null = null, text = nativeTemplate): ObituaryResultV1 {
  return { text, source: 'template', fallbackReason: reason, model: attemptedModel, ...provenance };
}
function reply(run: ObituaryRun, entry: ObituaryEntry, result = generated()): ObituaryReplyV1 {
  return { version: 1, operationKey: operationKey(run, entry), result, quota };
}
function expectTerminal(entry: ObituaryEntry, result: ObituaryResultV1): void {
  assert.equal(entry.attempt, 'terminal');
  assert.deepEqual(entry.result, result);
}
function finish(run: ObituaryRun, entry: ObituaryEntry, result: ObituaryResultV1): void {
  run.setOperationKey(entry, operationKey(run, entry));
  assert.equal(run.terminal(entry, result), true);
}
interface AttemptObservation { run: ObituaryRun; entry: ObituaryEntry; transport: MemoryTransport; changes: number }
async function attemptResponse(respond: (run: ObituaryRun, entry: ObituaryEntry, call: FetchCall) => Response | Promise<Response>, facts = freshFacts()): Promise<AttemptObservation> {
  const { run, entry } = admitted(7, facts);
  const transport = new MemoryTransport(call => respond(run, entry, call));
  let changes = 0;
  await startObituaryAttempt(run, entry, enabled, () => { changes += 1; }, transport);
  return { run, entry, transport, changes };
}
function heldBody(): { response: Response; controller: ReadableStreamDefaultController<Uint8Array>; reading: Promise<void> } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const reading = Promise.withResolvers<void>();
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { reading.resolve(); },
  }, { highWaterMark: 0 });
  return { response: new Response(stream), controller, reading: reading.promise };
}

// Additional lives below are closed consumer inputs, not claims about the native Nadine witness.
function consumerFacts(day: number): ObituaryFactsV1 {
  return { version: 1, deceased: { fullName: 'Grace Reed', sex: 'female', ageYears: 40,
    deathDate: { year: '15', day, label: `Year 15, Day ${day}` }, origin: 'borrowed body' },
  survivors: [], precededInDeath: [], debtActions: { forgivenDebts: null, demandsMade: null, peopleAskedForPayment: null },
  collections: { debtsPaidOn: null }, estate: null, jossBurnersOnDeathDay: '0' };
}
function consumerEntry(run: ObituaryRun, eventId: string, personId: number, tick: string, day: number): ObituaryEntry {
  const entry = run.admit({ eventId, personId, tick, lifeKey: `${run.worldId}/life/${personId}` }, consumerFacts(day));
  assert.ok(entry);
  return entry;
}

test('admission owns the exact life and publishes pending synchronously before the async operation digest', async () => {
  const run = new ObituaryRun(7);
  const facts = freshFacts();
  const death: ObituaryDeath = { eventId: '2368', personId: 10, tick: '5372', lifeKey: '7/life/10' };
  for (const lifeKey of ['8/life/10', '7/life/11', '7/life/010']) {
    assert.throws(() => run.admit({ ...death, lifeKey }, freshFacts()), /exact owned life/u);
  }
  assert.deepEqual(run.entries(), []);
  const entry = run.admit(death, facts);
  assert.ok(entry);
  const transport = new MemoryTransport(() => { throw new Error('Public narration must not POST.'); });
  let changes = 0;
  const attempt = startObituaryAttempt(run, entry, publicCapability, () => { changes += 1; }, transport);
  assert.deepEqual(run.entries(), [entry]);
  assert.equal(run.hasDeath('2368'), true);
  assert.equal(entry.runId, run.runId);
  assert.equal(entry.death.lifeKey, '7/life/10');
  assert.equal(entry.attempt, 'pending');
  assert.equal(entry.operationKey, null);
  assert.equal(entry.result, null);
  assert.equal(entry.ready, false);
  assert.deepEqual(run.visible(), []);
  assert.deepEqual(transport.calls, []);
  assert.equal(changes, 0);
  await attempt;
  assert.equal(entry.operationKey, sha256(`${run.runId}\0` + '2368'));
  expectTerminal(entry, template('public'));
  assert.equal(changes, 1);
  assert.deepEqual(transport.calls, []);
});

test('duplicate Death admission is a null no-op and any same-event identity conflict preserves the first entry', () => {
  const { run, entry } = admitted();
  const differentFacts = freshFacts();
  differentFacts.collections.debtsPaidOn = '0';
  assert.equal(run.admit({ ...entry.death }, differentFacts), null);
  for (const patch of [{ personId: 11 }, { tick: '5373' }, { lifeKey: '8/life/10' }]) {
    assert.throws(() => run.admit({ ...entry.death, ...patch }, freshFacts()), /identity changed/u);
  }
  assert.deepEqual(run.entries(), [entry]);
  assert.deepEqual(entry.facts, positive.facts);
  assert.equal(entry.template, nativeTemplate);
  assert.equal(entry.attempt, 'pending');
});

test('admission freezes death and every facts descendant, including beneath an already-frozen root', () => {
  const facts = freshFacts();
  Object.freeze(facts);
  const { entry } = admitted(7, facts);
  assert.throws(() => { entry.death.tick = '5373'; }, TypeError);
  assert.throws(() => { facts.deceased.fullName = 'Grace Reed'; }, TypeError);
  assert.throws(() => { facts.deceased.deathDate.day = 264; }, TypeError);
  assert.throws(() => { facts.survivors[0]!.firstName = 'Zelda'; }, TypeError);
  assert.throws(() => { facts.survivors.pop(); }, TypeError);
  assert.throws(() => { facts.precededInDeath[0]!.fullName = 'Zelda Bradley'; }, TypeError);
  assert.throws(() => { facts.debtActions.demandsMade = '0'; }, TypeError);
  assert.throws(() => { facts.collections.debtsPaidOn = '0'; }, TypeError);
  assert.ok(facts.estate);
  assert.throws(() => { facts.estate!.valueDollars = '0'; }, TypeError);
  assert.throws(() => { facts.estate!.heirs[0]!.fullName = 'Zelda Bradley'; }, TypeError);
  assert.throws(() => { facts.estate!.heirs.pop(); }, TypeError);
  assert.deepEqual(entry.facts, positive.facts);
  assert.equal(entry.template, nativeTemplate);
});

test('terminal-before-ready waits for its exact Death and ready-before-terminal reveals only after completion', () => {
  const first = admitted();
  finish(first.run, first.entry, generated());
  assert.deepEqual(first.run.visible(), []);
  assert.equal(first.run.markReady('other-death'), false);
  assert.deepEqual(first.run.visible(), []);
  assert.equal(first.run.markReady(first.entry.death.eventId), true);
  assert.deepEqual(first.run.visible(), [first.entry]);
  assert.equal(first.run.markReady(first.entry.death.eventId), false);

  const second = admitted(8);
  assert.equal(second.run.markReady(second.entry.death.eventId), true);
  assert.deepEqual(second.run.visible(), []);
  finish(second.run, second.entry, template('public'));
  assert.deepEqual(second.run.visible(), [second.entry]);
  assert.equal(second.entry.death.lifeKey, '8/life/10');
});

test('first terminal result wins, remains frozen, and cannot complete an entry owned by another run', () => {
  const { run, entry } = admitted();
  const first = generated();
  assert.throws(() => run.terminal(entry, first), /identity is not ready/u);
  assert.equal(entry.attempt, 'pending');
  run.setOperationKey(entry, operationKey(run, entry));
  assert.equal(run.terminal(entry, first), true);
  assert.throws(() => { first.text = 'Changed after completion.'; }, TypeError);
  assert.throws(() => { first.source = 'template'; }, TypeError);
  assert.equal(run.terminal(entry, template('timeout', model)), false);
  assert.equal(entry.result, first);
  expectTerminal(entry, generated());
  const foreign = admitted(8);
  assert.equal(foreign.run.terminal(entry, template('public')), false);
  assert.equal(foreign.entry.attempt, 'pending');
  assert.equal(foreign.entry.result, null);
  assert.deepEqual(foreign.run.visible(), []);
});

for (const scenario of [
  { name: 'public 404', response: () => json({}, 404), reason: 'public' },
  { name: 'anonymous 401', response: () => json({}, 401), reason: 'anonymous' },
  { name: 'invalid closed config', response: () => json({ ...enabled.capability, enabled: 'yes' }), reason: 'capability_unavailable' },
  { name: 'malformed config JSON', response: () => new Response('{'), reason: 'capability_unavailable' },
  { name: 'config network failure', response: () => { throw new Error('Private config failure.'); }, reason: 'capability_unavailable' },
] satisfies { name: string; response: () => Response; reason: FallbackReason }[]) {
  test(`${scenario.name} selects the exact local template and null model without any narration POST`, async () => {
    const transport = new MemoryTransport(call => {
      assert.equal(call.url, '/api/judge/obituary/config');
      assert.equal(call.init.method, 'GET');
      assert.equal(call.init.credentials, 'same-origin');
      assert.equal(call.init.cache, 'no-store');
      assert.equal(call.init.redirect, 'error');
      assert.equal(call.init.body, undefined);
      return scenario.response();
    });
    const capability = await fetchObituaryCapability(transport);
    assert.deepEqual(capability, { capability: null, reason: scenario.reason });
    const { run, entry } = admitted();
    let changes = 0;
    await startObituaryAttempt(run, entry, capability, () => { changes += 1; }, transport);
    expectTerminal(entry, template(scenario.reason));
    assert.equal(changes, 1);
    assert.deepEqual(transport.calls.map(call => [call.url, call.init.method]), [['/api/judge/obituary/config', 'GET']]);
    assert.equal(transport.timerCount, 0);
  });
}

test('disabled and exhausted valid capabilities terminate locally without reserving or posting', async () => {
  for (const disabledReason of ['disabled', 'quota_exhausted'] as const) {
    const config: ObituaryCapabilityV1 = { version: 1, enabled: false, model, disabledReason, timeout_ms: 10000,
      quota: { ...quota, daily_remaining: disabledReason === 'quota_exhausted' ? 0 : 39 } };
    const transport = new MemoryTransport(() => json(config));
    const capability = await fetchObituaryCapability(transport);
    assert.deepEqual(capability, { capability: config, reason: null });
    const { run, entry } = admitted();
    await startObituaryAttempt(run, entry, capability, () => {}, transport);
    expectTerminal(entry, template(disabledReason));
    assert.deepEqual(transport.calls.map(call => call.init.method), ['GET']);
    assert.equal(transport.timerCount, 0);
  }
});

test('eligible capability sends exactly one same-origin POST containing the independent run-NUL-Death hash and only frozen facts', async () => {
  const { run, entry } = admitted();
  const transport = new MemoryTransport(call => call.init.method === 'GET' ? json(enabled.capability) : json(reply(run, entry)));
  const capability = await fetchObituaryCapability(transport);
  assert.deepEqual(capability, enabled);
  let changes = 0;
  await startObituaryAttempt(run, entry, capability, () => { changes += 1; }, transport);
  const expectedKey = createHash('sha256').update(run.runId, 'utf8').update(Buffer.from([0])).update('2368', 'utf8').digest('hex');
  assert.equal(entry.operationKey, expectedKey);
  assert.notEqual(expectedKey, sha256(run.runId + '2368'));
  assert.deepEqual(transport.calls.map(call => [call.url, call.init.method]), [
    ['/api/judge/obituary/config', 'GET'], ['/api/obituary', 'POST'],
  ]);
  const post = transport.calls[1]!;
  assert.equal(post.init.credentials, 'same-origin');
  assert.equal(post.init.redirect, 'error');
  assert.equal(post.init.cache, 'no-store');
  assert.deepEqual([...new Headers(post.init.headers)], [['content-type', 'application/json']]);
  assert.equal(typeof post.init.body, 'string');
  assert.deepEqual(JSON.parse(String(post.init.body)), { version: 1, operationKey: expectedKey, facts: positive.facts });
  expectTerminal(entry, generated());
  assert.equal(entry.result!.text, positive.paragraph);
  assert.equal(changes, 1);
  assert.equal(transport.timerCount, 0);
  assert.equal(run.admit({ ...entry.death }, freshFacts()), null);
  assert.equal(transport.calls.filter(call => call.init.method === 'POST').length, 1);
});

test('an accepted paragraph is joined to this entry roster, never a prior run or another facts object', async () => {
  const accepted = await attemptResponse((run, entry) => json(reply(run, entry)));
  expectTerminal(accepted.entry, generated());
  const facts = freshFacts();
  // Consumer-only roster omission: remove Marcus from every name-authority location.
  facts.survivors = facts.survivors.filter(person => person.firstName !== 'Marcus');
  assert.ok(facts.estate);
  facts.estate.heirs = facts.estate.heirs.filter(person => person.fullName !== 'Marcus Bradley');
  const rejected = await attemptResponse((run, entry) => json(reply(run, entry)), facts);
  expectTerminal(rejected.entry, template('unknown_name', model, renderObituaryTemplate(facts)));
  assert.equal(accepted.entry.result!.text, positive.paragraph);
  assert.notEqual(accepted.run.runId, rejected.run.runId);
  assert.equal(rejected.changes, 1);
});

for (const [name, text, reason] of [
  ['unknown roster name', positive.paragraph.replace('her son Marcus', 'her son Zelda'), 'unknown_name'],
  ['cause of death', positive.paragraph.replace('She leaves', 'She died of cancer and leaves'), 'invalid_output'],
  ['occupation', positive.paragraph.replace('She leaves', 'She worked as a nurse and leaves'), 'invalid_output'],
  ['hobby', positive.paragraph.replace('She leaves', 'She enjoyed gardening and leaves'), 'invalid_output'],
  ['feeling', positive.paragraph.replace('She leaves', 'She felt happy and leaves'), 'invalid_output'],
  ['unprovided place', positive.paragraph.replace('She leaves', 'She lived in the city and leaves'), 'invalid_output'],
  ['reader address', positive.paragraph.replace('She leaves', 'You inherit'), 'invalid_output'],
  ['quotation', positive.paragraph.replace('She leaves', 'She said "hello" and leaves'), 'invalid_output'],
  ['rewritable outer whitespace', ` ${positive.paragraph} `, 'invalid_output'],
] as const) {
  test(`model ${name} becomes the exact frozen template, not rewritten or provider text`, async () => {
    const observation = await attemptResponse((run, entry) => json(reply(run, entry, generated(text))));
    expectTerminal(observation.entry, template(reason, model));
    assert.equal(observation.changes, 1);
    assert.equal(observation.transport.calls.length, 1);
    assert.equal(observation.transport.timerCount, 0);
  });
}

test('successful envelopes must join the exact operation, prompt provenance, and approved template words', async () => {
  const mutations: ((value: ObituaryReplyV1) => ObituaryReplyV1)[] = [
    value => ({ ...value, operationKey: '0'.repeat(64) }),
    value => ({ ...value, result: { ...value.result, promptVersion: 'obituary.author.v3' } }),
    value => ({ ...value, result: { ...value.result, promptSha256: '0'.repeat(64) } }),
    value => ({ ...value, result: template('provider_error', model, nativeTemplate + ' Changed.') }),
  ];
  for (const mutate of mutations) {
    const observation = await attemptResponse((run, entry) => json(mutate(reply(run, entry))));
    expectTerminal(observation.entry, template('invalid_output', model));
    assert.equal(observation.changes, 1);
  }
  const accepted = await attemptResponse((run, entry) => json(reply(run, entry, template('provider_error', model))));
  expectTerminal(accepted.entry, template('provider_error', model));
  assert.equal(accepted.changes, 1);
});

test('server rejection before admission preserves its closed reason and null model without claiming a provider attempt', async () => {
  for (const [status, reason] of [[400, 'request_invalid'], [413, 'request_too_large'], [401, 'anonymous'],
    [429, 'quota_exhausted'], [409, 'duplicate'], [503, 'admission_unavailable'], [503, 'disabled']] as const) {
    const observation = await attemptResponse(() => json({ version: 1, error: reason }, status));
    expectTerminal(observation.entry, template(reason));
    assert.equal(observation.changes, 1);
    assert.deepEqual(observation.transport.calls.map(call => [call.url, call.init.method]), [['/api/obituary', 'POST']]);
    assert.equal(observation.transport.timerCount, 0);
  }
});

test('malformed JSON, fatal UTF-8, empty bodies, and network rejection cannot expose provider text', async () => {
  for (const respond of [
    () => new Response('{"provider_secret":"hidden",'),
    () => new Response(new Uint8Array([0xff])),
    () => new Response(null, { status: 204 }),
  ]) {
    const observation = await attemptResponse(respond);
    expectTerminal(observation.entry, template('invalid_output', model));
    assert.equal(observation.changes, 1);
    assert.equal(observation.transport.timerCount, 0);
  }
  const network = await attemptResponse(() => { throw new Error('Provider secret and network failure.'); });
  expectTerminal(network.entry, template('network', model));
  assert.equal(network.changes, 1);
});

test('response streaming accepts exactly 8192 actual bytes and cancels oversized bytes despite a lying Content-Length', async () => {
  for (const bytes of [8192, 8193]) {
    let cancelled = false;
    const observation = await attemptResponse((run, entry) => {
      const encoded = new TextEncoder().encode(JSON.stringify(reply(run, entry)));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded);
          controller.enqueue(new TextEncoder().encode(' '.repeat(bytes - encoded.byteLength)));
          if (bytes === 8192) controller.close();
        },
        cancel() { cancelled = true; },
      });
      return new Response(stream, { headers: { 'Content-Length': '1' } });
    });
    expectTerminal(observation.entry, bytes === 8192 ? generated() : template('invalid_output', model));
    assert.equal(cancelled, bytes === 8193);
    assert.equal(observation.changes, 1);
    assert.equal(observation.transport.timerCount, 0);
  }
});

for (const stage of ['headers', 'body', 'provider rejection'] as const) {
  test(`the numeric-clock 10s fallback wins over late ${stage} and cannot touch a newer run with the same Death ID`, async () => {
    const old = admitted();
    const headers = Promise.withResolvers<Response>();
    const body = heldBody();
    const transport = new MemoryTransport(() => stage === 'body' ? body.response : headers.promise);
    let oldChanges = 0;
    old.run.markReady(old.entry.death.eventId);
    const attempt = startObituaryAttempt(old.run, old.entry, enabled, () => { oldChanges += 1; }, transport);
    await transport.requested.promise;
    if (stage === 'body') await body.reading;
    assert.equal(transport.timerCount, 1);
    transport.advance(9999);
    assert.equal(old.entry.attempt, 'pending');
    assert.equal(old.entry.result, null);
    assert.equal(oldChanges, 0);
    assert.deepEqual(old.run.visible(), []);
    transport.advance(1);
    expectTerminal(old.entry, template('timeout', model));
    const firstResult = old.entry.result;
    assert.equal(oldChanges, 1);
    assert.deepEqual(old.run.visible(), [old.entry]);

    const current = admitted(8);
    current.run.markReady(current.entry.death.eventId);
    let currentChanges = 0;
    const currentTransport = new MemoryTransport(() => json(reply(current.run, current.entry)));
    await startObituaryAttempt(current.run, current.entry, enabled, () => { currentChanges += 1; }, currentTransport);
    expectTerminal(current.entry, generated());
    assert.deepEqual(current.run.visible(), [current.entry]);
    assert.notEqual(current.entry.operationKey, old.entry.operationKey);
    if (stage === 'body') {
      body.controller.enqueue(new TextEncoder().encode(JSON.stringify(reply(old.run, old.entry))));
      body.controller.close();
    } else if (stage === 'provider rejection') headers.reject(new Error('Late provider secret.'));
    else headers.resolve(json(reply(old.run, old.entry)));
    await attempt;
    assert.equal(old.entry.result, firstResult);
    expectTerminal(old.entry, template('timeout', model));
    expectTerminal(current.entry, generated());
    assert.deepEqual(current.run.visible(), [current.entry]);
    assert.equal(oldChanges, 1);
    assert.equal(currentChanges, 1);
    assert.equal(transport.calls.length, 1);
    assert.equal(currentTransport.calls.length, 1);
    assert.equal(transport.timerCount, 0);
  });
}

for (const stage of ['headers', 'body'] as const) {
  for (const elapsed of [9999, 10000]) {
    test(`logical deadline checks ${stage} at ${elapsed}ms even when the timer callback has not run`, async () => {
      const { run, entry } = admitted();
      const headers = Promise.withResolvers<Response>();
      const body = heldBody();
      const transport = new MemoryTransport(() => stage === 'headers' ? headers.promise : body.response);
      transport.elapse(50000);
      let changes = 0;
      const attempt = startObituaryAttempt(run, entry, enabled, () => { changes += 1; }, transport);
      await transport.requested.promise;
      if (stage === 'body') await body.reading;
      transport.elapse(elapsed);
      assert.equal(entry.attempt, 'pending');
      assert.equal(changes, 0);
      assert.equal(transport.timerCount, 1);
      if (stage === 'headers') headers.resolve(json(reply(run, entry)));
      else {
        body.controller.enqueue(new TextEncoder().encode(JSON.stringify(reply(run, entry))));
        body.controller.close();
      }
      await attempt;
      expectTerminal(entry, elapsed === 9999 ? generated() : template('timeout', model));
      assert.equal(changes, 1);
      assert.equal(transport.timerCount, 0);
    });
  }
}

test('sidecar binds original v5 replay bytes by independent SHA256 and exports only the half-open prefix with exact provenance', async () => {
  const { run, entry } = admitted();
  const transport = new MemoryTransport(() => json(reply(run, entry)));
  await startObituaryAttempt(run, entry, enabled, () => {}, transport);
  const beforeEnd = consumerEntry(run, '9001', 20, '5375', 266);
  const consumerTemplate = renderObituaryTemplate(beforeEnd.facts);
  finish(run, beforeEnd, template('public', null, consumerTemplate));
  const atEnd = consumerEntry(run, '9002', 21, '5376', 267);
  const afterEnd = consumerEntry(run, '9003', 22, '5377', 268);
  assert.equal(atEnd.attempt, 'pending');
  assert.equal(afterEnd.attempt, 'pending');
  assert.deepEqual(run.visible(), [], 'archive does not require reveal readiness');
  assert.equal(sha256(prompt), 'bcfd04e1d158dafc7f8361c442cee0ab41f177c74e02f549e6f69b3518a491fb');
  const archive = await exportObituarySidecar(run, replayBytes);
  assert.deepEqual(archive, {
    format: 'back-in-the-family/obituaries', version: 1, replaySha256: createHash('sha256').update(replayBytes, 'utf8').digest('hex'),
    records: [
      { runId: run.runId, death: { eventId: '2368', personId: 10, tick: '5372', lifeKey: '7/life/10' },
        operationKey: operationKey(run, entry), facts: positive.facts, attempt: 'terminal',
        result: { text: positive.paragraph, source: 'model', fallbackReason: null,
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', promptVersion: 'obituary.author.v2',
          promptSha256: createHash('sha256').update(prompt, 'utf8').digest('hex') } },
      { runId: run.runId, death: { eventId: '9001', personId: 20, tick: '5375', lifeKey: '7/life/20' },
        operationKey: operationKey(run, beforeEnd), facts: consumerFacts(266), attempt: 'terminal',
        result: { text: consumerTemplate, source: 'template', fallbackReason: 'public', model: null,
          promptVersion: 'obituary.author.v2', promptSha256: createHash('sha256').update(prompt, 'utf8').digest('hex') } },
    ],
  });
  const differentlySpacedBytes = replayBytes + '\n ';
  const differentByteArchive = await exportObituarySidecar(run, differentlySpacedBytes);
  assert.equal(differentByteArchive.replaySha256, sha256(differentlySpacedBytes));
  assert.notEqual(differentByteArchive.replaySha256, archive.replaySha256, 'digest is byte binding, not JSON normalization');
  assert.deepEqual(differentByteArchive.records, archive.records);
  assert.deepEqual(transport.calls.map(call => [call.url, call.init.method]), [['/api/obituary', 'POST']]);
  assert.equal(atEnd.result, null);
  assert.equal(afterEnd.result, null);
});

test('export rejects an included pending Death but accepts an excluded pending Death at the exact prefix tick', async () => {
  const included = new ObituaryRun(7);
  const pending = consumerEntry(included, '9001', 20, '5375', 266);
  await assert.rejects(exportObituarySidecar(included, replayBytes), /prefix still has a pending obituary/u);
  assert.equal(pending.attempt, 'pending');
  assert.equal(pending.operationKey, null);
  const excluded = new ObituaryRun(8);
  const boundary = consumerEntry(excluded, '9002', 21, '5376', 267);
  assert.deepEqual(await exportObituarySidecar(excluded, replayBytes), {
    format: 'back-in-the-family/obituaries', version: 1, replaySha256: sha256(replayBytes), records: [],
  });
  assert.equal(boundary.attempt, 'pending');
  assert.equal(boundary.operationKey, null);
});

test('export captures only terminal records present before its async digest, not a later admitted in-prefix life', async () => {
  const { run, entry } = admitted();
  finish(run, entry, generated());
  const exporting = exportObituarySidecar(run, replayBytes);
  const later = consumerEntry(run, '9001', 20, '5375', 266);
  const archive = await exporting;
  assert.deepEqual(archive.records.map(record => record.death.eventId), ['2368']);
  assert.equal(archive.replaySha256, sha256(replayBytes));
  assert.equal(later.attempt, 'pending');
  await assert.rejects(exportObituarySidecar(run, replayBytes), /pending obituary/u);
});

test('export rejects terminal facts whose frozen death date does not match the record tick', async () => {
  const run = new ObituaryRun(7);
  const entry = run.admit({ eventId: '2368', personId: 10, tick: '5373', lifeKey: '7/life/10' }, freshFacts());
  assert.ok(entry);
  finish(run, entry, generated());
  await assert.rejects(exportObituarySidecar(run, replayBytes), /Invalid terminal obituary archive/u);
});

for (const providerTiming of ['in budget', 'after budget'] as const) {
  test(`pending initialization is consumed once and its wait shares the 10s budget: provider ${providerTiming}`, async () => {
    const { run, entry } = admitted();
    const headers = Promise.withResolvers<Response>();
    const provider = Promise.withResolvers<Response>();
    const posted = Promise.withResolvers<void>();
    const transport = new MemoryTransport(call => {
      if (call.init.method === 'GET') return headers.promise;
      posted.resolve(); return provider.promise;
    });
    const capability = fetchObituaryCapability(transport);
    let changes = 0;
    const attempt = startObituaryAttempt(run, entry, capability, () => { changes++; }, transport);
    await transport.timerStarted.promise;
    transport.advance(8000);
    assert.equal(entry.attempt, 'pending');
    assert.equal(changes, 0);
    assert.equal(transport.calls.filter(call => call.init.method === 'POST').length, 0);
    headers.resolve(json(enabled.capability));
    await posted.promise;
    assert.equal(transport.calls.filter(call => call.init.method === 'GET').length, 1);
    assert.equal(transport.calls.filter(call => call.init.method === 'POST').length, 1);
    if (providerTiming === 'after budget') {
      transport.advance(2000);
      expectTerminal(entry, template('timeout', model));
    }
    provider.resolve(json(reply(run, entry)));
    await attempt;
    expectTerminal(entry, providerTiming === 'in budget' ? generated() : template('timeout', model));
    assert.equal(changes, 1);
    assert.equal(transport.timerCount, 0);
  });
}

test('pending capability reaches a null-model terminal deadline and a later GET never posts for that Death', async () => {
  const { run, entry } = admitted();
  const headers = Promise.withResolvers<Response>();
  const transport = new MemoryTransport(call => {
    assert.equal(call.init.method, 'GET', 'The expired Death must never POST.');
    return headers.promise;
  });
  const capability = fetchObituaryCapability(transport);
  let changes = 0;
  const attempt = startObituaryAttempt(run, entry, capability, () => { changes++; }, transport);
  await transport.timerStarted.promise;
  transport.advance(10000);
  await attempt;
  expectTerminal(entry, template('timeout'));
  const first = entry.result;
  headers.resolve(json(enabled.capability));
  await capability;
  assert.equal(entry.result, first);
  assert.equal(changes, 1);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.timerCount, 0);
});

test('an actually failed initialization is distinct from pending and terminates without POST', async () => {
  const { run, entry } = admitted();
  const headers = Promise.withResolvers<Response>();
  const transport = new MemoryTransport(() => headers.promise);
  const capability = fetchObituaryCapability(transport);
  const attempt = startObituaryAttempt(run, entry, capability, () => {}, transport);
  await transport.timerStarted.promise;
  headers.reject(new Error('Controlled capability network failure.'));
  await attempt;
  expectTerminal(entry, template('capability_unavailable'));
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.timerCount, 0);
});
