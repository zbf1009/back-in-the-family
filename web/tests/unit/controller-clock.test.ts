// Feature: web-shell, Property 6: Clock and frame timing never reach the simulation
// Clock pacing necessarily changes tick counts. The preserved invariant is that
// only those counts vary: request bytes and every completed tick match a direct
// reference, including under jitter, a frozen clock, and shifted time origins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { Request, WorkerMessage } from '../../src/shared/protocol.ts';
import { DEFAULT_SPEED, PLAY_RATE, SPEEDS } from '../../src/shared/speeds.ts';
import { createSim, loadWasm } from './helpers/wasm.ts';
import { FakeClock, FakeFrameScheduler, RecordingSimHandle, messageCollector } from './helpers/fakes.ts';
import { commandsArb, U64_MAX, type Command } from './helpers/gen.ts';
import { PacingReference } from './helpers/reference.ts';

const RUNS = 1000;
function request(cmd: Exclude<Command, { kind: 'fire-frames' }>, id: number): Request {
  switch (cmd.kind) {
    case 'create-world': return { type: cmd.kind, id, seed: cmd.seed, config: cmd.config };
    case 'set-speed': return { type: cmd.kind, id, speed: cmd.speed };
    case 'submit': return { type: cmd.kind, id, input: cmd.input };
    case 'request': return { ...cmd.request, id };
    case 'run': case 'pause': case 'step': return { type: cmd.kind, id };
  }
}

function runWithClock(commands: readonly Command[], origin: number, jitter: readonly number[]) {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(origin);
  const { post, messages } = messageCollector<WorkerMessage>();
  const handles: RecordingSimHandle[] = [];
  const references: SimHandle[] = [];
  const history: string[][] = [];
  const pace = new PacingReference();
  let speed: number = DEFAULT_SPEED;
  let running = false;
  const controller = new SimController({
    createSim: (seed, config) => {
      assert.ok(seed >= 0n && seed <= U64_MAX);
      const rec = new RecordingSimHandle(createSim(seed, config));
      handles.push(rec);
      references.push(createSim(seed, config));
      history.push([]);
      return rec;
    }, scheduler, clock, post,
  });
  controller.ready();
  let id = 1;
  let frame = 0;
  let consumed = 0;
  const extendAndCheck = () => {
    const rec = handles.at(-1);
    const ref = references.at(-1);
    const sums = history.at(-1);
    if (rec && ref && sums) {
      while (ref.tick() < rec.tick()) sums.push(ref.step());
      assert.equal(ref.tick(), rec.tick());
      assert.deepEqual(JSON.parse(rec.checksums(0n, rec.tick())), sums);
    }
    for (; consumed < messages.length; consumed++) {
      const m = messages[consumed];
      assert.notEqual(m.type, 'fatal');
      if (m.type === 'fatal') continue;
      if (m.snapshot.tick !== null && Number(m.snapshot.tick) > 0) {
        assert.equal(m.snapshot.checksum, sums![Number(m.snapshot.tick) - 1]);
      } else assert.equal(m.snapshot.checksum, null);
    }
  };
  for (const cmd of commands) {
    if (cmd.kind === 'fire-frames') {
      for (let k = 0; k < cmd.count; k++) {
        clock.advance(jitter[frame++ % jitter.length] ?? 0);
        const rec = handles.at(-1);
        const before = rec?.mutatingCalls.length ?? 0;
        const tickBefore = rec?.tick() ?? 0n;
        const expected: number = running ? pace.frame(clock.now(), speed) : 0;
        assert.equal(scheduler.flush(), running);
        const calls = rec?.mutatingCalls.slice(before) ?? [];
        assert.deepEqual(calls, expected > 0 ? [{ method: 'run_until_stop', n: expected }] : []);
        if (expected > 0) pace.recordActual(expected, Number(rec!.tick() - tickBefore));
        running = scheduler.isPending;
        extendAndCheck();
      }
      continue;
    }
    const req = request(cmd, id++);
    const before = messages.length;
    const callsBefore = handles.at(-1)?.mutatingCalls.length ?? 0;
    controller.handle(req);
    const replies = messages.slice(before).filter((m) => m.type === 'reply');
    assert.equal(replies.length, 1);
    const reply = replies[0];
    assert.ok(reply.type === 'reply');
    if (reply.ok) {
      if (cmd.kind === 'create-world') { running = false; speed = DEFAULT_SPEED; }
      if (cmd.kind === 'run') {
        if (!running) pace.reset(clock.now());
        running = true;
      }
      if (cmd.kind === 'pause') running = false;
      if (cmd.kind === 'set-speed') {
        if (running && speed !== cmd.speed) pace.reset(clock.now());
        speed = cmd.speed;
      }
      // Accepted request inputs are byte-identical and queued at the same tick
      // on the reference. Jitter may cause a past-tick submit rejection; that is
      // an input-stream difference, not a permitted checksum difference.
      if (cmd.kind === 'submit') references.at(-1)!.submit(cmd.input);
      if (cmd.kind === 'request') {
        const calls = handles.at(-1)!.mutatingCalls.slice(callsBefore);
        for (const call of calls) if (call.method === 'submit_checked') {
          assert.equal(JSON.parse(references.at(-1)!.submit_checked(call.input)).ok, true);
        }
      }
    }
    extendAndCheck();
  }
  const generatedInputs = new Set(commands.flatMap((c) => c.kind === 'submit' ? [c.input] : []));
  for (const rec of handles) for (const call of rec.mutatingCalls) {
    if (call.method === 'submit') assert.ok(generatedInputs.has(call.input));
    else if (call.method === 'submit_checked') {
      assert.ok(Array.isArray(JSON.parse(call.input)), 'checked calls contain v5 payload arrays, never clock values');
    }
    else {
      assert.equal(call.method, 'run_until_stop', 'controller never calls legacy step/run_ticks');
      assert.ok(call.method === 'run_until_stop');
      assert.ok(Number.isInteger(call.n) && call.n > 0);
      assert.ok(call.n <= Math.ceil(Math.max(...SPEEDS) * PLAY_RATE / 20));
    }
  }
  return { calls: handles.map((h) => h.mutatingCalls), history };
}

test('clock origins preserve Sim calls while arbitrary frame timing changes only bounded counts and never per-tick results', () => {
  loadWasm();
  fc.assert(fc.property(commandsArb(), fc.integer({ min: 0, max: 10_000_000 }),
    fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 10 }),
    (commands, origin, jitter) => {
      const steady = runWithClock(commands, 0, [16]);
      const shifted = runWithClock(commands, origin, [16]);
      assert.deepEqual(shifted, steady, 'a time origin cannot reach a simulation call');
      runWithClock(commands, origin, jitter); // every tick compared independently
    }), { numRuns: RUNS });
});

test('a frozen clock advances no frame ticks but explicit steps preserve the moving-clock per-tick checksum', () => {
  const commands: Command[] = [
    { kind: 'create-world', seed: '42', config: '{"opening_residents":45}' },
    { kind: 'submit', input: '{"tick":"0","payload":{"Act":{"kind":"help","actor":"1","target":"2","intensity":40}}}' },
    { kind: 'set-speed', speed: 7 }, { kind: 'run' }, { kind: 'fire-frames', count: 5 },
    { kind: 'pause' }, { kind: 'step' }, { kind: 'set-speed', speed: 365 },
    { kind: 'run' }, { kind: 'fire-frames', count: 3 }, { kind: 'pause' },
  ];
  const moving = runWithClock(commands, 0, [16]);
  const frozen = runWithClock(commands, 7777, [0]);
  assert.equal(frozen.history[0].length, 1, 'only the explicit step advances');
  assert.ok(moving.history[0].length > frozen.history[0].length);
  assert.equal(frozen.history[0][0], moving.history[0][0]);
  assert.deepEqual(frozen.calls[0].filter((c) => c.method === 'run_until_stop'), [{ method: 'run_until_stop', n: 1 }]);
});
