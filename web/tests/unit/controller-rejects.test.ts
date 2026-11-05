// Feature: web-shell, Property 3: Rejected requests change nothing and never reach Sim_Wasm with bad arguments
//
// Validates: Requirements 2.10, 2.11, 3.6, 4.11, 6.3, 6.4
//
// Property 3 (design.md): For any reachable controller state and any request that
// is rejected (seed that parseSeed rejects, Speed not in SPEEDS, a request in
// no-world, a step while running, a config the WasmSim constructor rejects, an
// input WasmSim.submit rejects), the failure reply's snapshot equals the snapshot
// before the request, the next snapshot equals it too, and a recording wrapper
// around SimHandle shows no call for a rejected seed or Speed. Across all
// requests, every recorded createSim seed is a bigint in [0, 2^64 - 1] and every
// run_ticks argument is a member of SPEEDS.
//
// The controller runs the real WasmSim from target/wasm-pkg, wrapped so every
// created world is a RecordingSimHandle (records submit/step/run_ticks/tick with
// their arguments). A hand-driven FakeFrameScheduler and FakeClock plus a
// messageCollector make the run loop and snapshots observable (R6.6). A generated
// command sequence (gen.ts commandsArb) drives it; it already mixes invalid
// create-world (bad seed, bad config), set-speed with values outside SPEEDS,
// requests while no-world, step while running and malformed submit, which are the
// rejection paths this property targets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { Request, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import { SPEEDS } from '../../src/shared/speeds.ts';
import { createSim as realCreateSim, loadWasm } from './helpers/wasm.ts';
import { FakeClock, FakeFrameScheduler, messageCollector, RecordingSimHandle } from './helpers/fakes.ts';
import { commandsArb, type Command, U64_MAX } from './helpers/gen.ts';

const RUNS = 1000;

/** The u32 upper bound for run_ticks arguments (R6.3). */
const U32_MAX = 4_294_967_295;

/** A reply message (ok true or false), narrowed from WorkerMessage. */
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

/** A posted message plus, for a reply, the request it answered (so a rejected request is identifiable). */
interface Event {
  message: WorkerMessage;
  /** The request this message replied to, or null for a status/fatal message. */
  request: Request | null;
}

/**
 * The seeds and configs every createSim call was given, in call order. Property 3
 * requires every recorded seed to be a bigint in [0, 2^64 - 1] (an invalid seed
 * must never reach the constructor, R2.10/R6.4). `calls` records each attempt; a
 * rejected seed produces no entry because the controller never calls createSim.
 */
interface CreateCall {
  seed: bigint;
  config: string;
}

/** Compare two snapshots by value for the fields the display and protocol expose. */
function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return (
    a.worldId === b.worldId &&
    a.runState === b.runState &&
    a.tick === b.tick &&
    a.checksum === b.checksum &&
    a.speed === b.speed
  );
}

/** A compact string for assertion messages. */
function fmtSnapshot(s: Snapshot): string {
  return `{worldId:${s.worldId}, runState:${s.runState}, tick:${s.tick}, checksum:${s.checksum}, speed:${s.speed}}`;
}

/**
 * The outcome of driving one command sequence: the ordered events (every posted
 * message with the request it answered, if any), the handles created (each a
 * RecordingSimHandle), and the seeds/configs passed to createSim.
 */
interface Outcome {
  events: Event[];
  handles: RecordingSimHandle[];
  createCalls: CreateCall[];
}

/**
 * Build a controller over the real WasmSim, wrapping every created world in a
 * RecordingSimHandle, and run a command sequence through it. Each protocol request
 * is tagged onto the reply it produces (by matching the single reply with the same
 * id), so a rejected request (ok:false) can be located and its before/after state
 * compared.
 */
function runCommands(commands: readonly Command[]): Outcome {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);

  const handles: RecordingSimHandle[] = [];
  const createCalls: CreateCall[] = [];
  const createSim = (seed: bigint, config: string): SimHandle => {
    createCalls.push({ seed, config });
    // Wrap the real WasmSim so every mutating call is recorded. A throwing
    // constructor (bad config) propagates before a handle is pushed, so a
    // rejected create adds no handle and records no call (R3.6).
    const inner = realCreateSim(seed, config);
    const recording = new RecordingSimHandle(inner);
    handles.push(recording);
    return recording;
  };

  const { post, messages } = messageCollector<WorkerMessage>();
  const controller = new SimController({ createSim, scheduler, clock, post });
  // The WASM is loaded synchronously in Node (worker entry calls ready() after
  // init()); mark it ready so requests dispatch in order.
  controller.ready();

  // Track where in `messages` we are so each request's reply can be attached.
  const events: Event[] = [];
  let consumed = 0;
  const drain = (request: Request | null): void => {
    for (; consumed < messages.length; consumed++) {
      events.push({ message: messages[consumed], request });
    }
  };

  let nextId = 1;
  for (const cmd of commands) {
    if (cmd.kind === 'fire-frames') {
      for (let i = 0; i < cmd.count; i++) {
        // The clock advances only for pacing and tps; it never reaches the
        // simulation (R6.5). Status messages posted during frames are attached
        // with request null.
        clock.advance(16);
        scheduler.flush();
      }
      drain(null);
      continue;
    }
    const id = nextId++;
    const req = toRequest(cmd, id);
    controller.handle(req);
    // Every message posted while handling this request (the single reply, and any
    // status from a frame is impossible here since no frame fired) is attached to
    // this request.
    drain(req);
  }

  return { events, handles, createCalls };
}

/** Map a generated Command (other than fire-frames) to a protocol Request with the given id. */
function toRequest(cmd: Exclude<Command, { kind: 'fire-frames' }>, id: number): Request {
  switch (cmd.kind) {
    case 'create-world':
      return { type: 'create-world', id, seed: cmd.seed, config: cmd.config };
    case 'run':
      return { type: 'run', id };
    case 'pause':
      return { type: 'pause', id };
    case 'step':
      return { type: 'step', id };
    case 'set-speed':
      return { type: 'set-speed', id, speed: cmd.speed };
    case 'submit':
      return { type: 'submit', id, input: cmd.input };
  }
}

/** Total number of state-changing calls (submit/step/run_ticks) across every handle. */
function totalMutatingCalls(handles: readonly RecordingSimHandle[]): number {
  return handles.reduce((sum, h) => sum + h.mutatingCalls.length, 0);
}

// Property 3: rejected requests change nothing and never reach Sim_Wasm with bad
// arguments.
test('controller rejects requests without changing state or reaching Sim_Wasm with bad arguments', () => {
  // Load once up front so the first property run is not timed out by WASM init.
  loadWasm();

  fc.assert(
    fc.property(commandsArb(), (commands) => {
      const { events, handles, createCalls } = runCommands(commands);

      // Replay the event stream to track, just before each reply, the snapshot the
      // controller last reported (the "snapshot before the request") and the total
      // mutating-call count. A rejected request must leave both unchanged.
      //
      // `lastSnapshot` starts as the no-world snapshot the controller reports in its
      // very first reply; before any reply there is nothing to compare, so we seed it
      // from the first message's snapshot when we reach it.
      let lastSnapshot: Snapshot | null = null;

      for (const { message, request } of events) {
        if (message.type === 'fatal') {
          continue; // carries no snapshot
        }

        if (message.type === 'status') {
          // A status reflects a completed tick; it updates the "last good" snapshot.
          lastSnapshot = message.snapshot;
          continue;
        }

        // message.type === 'reply'
        const reply: ReplyMessage = message;

        if (reply.ok === false) {
          // A rejected request (R2.10, R2.11, R3.6, R4.11, R6.4).
          //
          // (a) The failure reply's snapshot equals the snapshot before the request.
          //     If no prior snapshot was observed, the before-state is the initial
          //     no-world snapshot, which is exactly what a rejected first request
          //     reports; capture it and require later rejects to match it.
          if (lastSnapshot !== null) {
            assert.ok(
              snapshotsEqual(reply.snapshot, lastSnapshot),
              `rejected request ${reply.kind} changed the reported snapshot: ` +
                `before ${fmtSnapshot(lastSnapshot)}, after ${fmtSnapshot(reply.snapshot)}`,
            );
          }
          // The failure reply does not advance the "last good" snapshot: the next
          // snapshot must equal this one too. We keep `lastSnapshot` unchanged.
          if (lastSnapshot === null) {
            lastSnapshot = reply.snapshot;
          }
          continue;
        }

        // A successful reply: it may legitimately change the snapshot (create, step,
        // run, pause, set-speed). Adopt it as the new "last good" snapshot.
        lastSnapshot = reply.snapshot;
      }

      // Across the whole run: every recorded createSim seed is a bigint in
      // [0, 2^64 - 1] (an invalid seed never reached the constructor, R2.10/R6.4).
      for (const call of createCalls) {
        assert.equal(typeof call.seed, 'bigint', `createSim seed must be a bigint, got ${typeof call.seed}`);
        assert.ok(
          call.seed >= 0n && call.seed <= U64_MAX,
          `createSim seed out of u64 range: ${call.seed}`,
        );
      }

      // Every run_ticks argument is in [0, 2^32 - 1] and, more strongly, is a member
      // of SPEEDS (the only Speed values the controller batches with; R6.3, R4.11).
      for (const h of handles) {
        for (const n of h.runTicksArgs) {
          assert.ok(Number.isInteger(n), `run_ticks arg not an integer: ${n}`);
          assert.ok(n >= 0 && n <= U32_MAX, `run_ticks arg out of u32 range: ${n}`);
          assert.ok(
            (SPEEDS as readonly number[]).includes(n),
            `run_ticks arg not a member of SPEEDS: ${n}`,
          );
        }
      }
    }),
    { numRuns: RUNS },
  );
});

// Focused property: a create-world that the WasmSim constructor rejects (bad
// config) while a world is RUNNING leaves the running world's worldId unchanged
// and still running, and makes no state-changing call on the old world for that
// request (R2.10, R3.6, R3.7).
test('a failed create while running leaves the running world running and untouched', () => {
  loadWasm();

  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const handles: RecordingSimHandle[] = [];
  const createSim = (seed: bigint, config: string): SimHandle => {
    const recording = new RecordingSimHandle(realCreateSim(seed, config));
    handles.push(recording);
    return recording;
  };
  const { post, messages } = messageCollector<WorkerMessage>();
  const controller = new SimController({ createSim, scheduler, clock, post });
  controller.ready();

  // Create a valid world and start running.
  controller.handle({ type: 'create-world', id: 1, seed: '42', config: '{"entity_count":5,"workload":"Pairwise"}' });
  controller.handle({ type: 'run', id: 2 });
  // Fire a couple of frames so the world has actually advanced ticks.
  for (let i = 0; i < 3; i++) {
    clock.advance(16);
    scheduler.flush();
  }

  const runningWorld = handles[0];
  const mutatingBefore = runningWorld.mutatingCalls.length;
  assert.equal(handles.length, 1, 'only the first world was created');

  // Attempt a create-world with a config the constructor rejects.
  controller.handle({ type: 'create-world', id: 3, seed: '7', config: 'not valid json' });

  // The reply for id 3 is a failure; no new world handle was added.
  const reply = messages.find(
    (m): m is ReplyMessage => m.type === 'reply' && m.id === 3,
  );
  assert.ok(reply, 'a reply was posted for the failed create');
  assert.equal(reply.ok, false, 'the failed create replied with ok:false');
  if (reply.ok === false) {
    assert.equal(reply.kind, 'sim-error', 'a bad config yields a sim-error');
    // The reported snapshot still describes the first, running world.
    assert.equal(reply.snapshot.worldId, 1, 'worldId unchanged by the failed create');
    assert.equal(reply.snapshot.runState, 'running', 'the world is still running');
  }

  // The failed create created no second handle and made no call on the old world.
  assert.equal(handles.length, 1, 'the failed create added no new world');
  assert.equal(
    runningWorld.mutatingCalls.length,
    mutatingBefore,
    'the failed create made no state-changing call on the running world',
  );
});
