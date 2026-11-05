// Feature: web-shell, Property 2: Exactly one well-formed reply per request, in order
//
// Validates: Requirements 2.4, 2.5, 2.7
//
// Property 2 (design.md): For any sequence of requests (valid and invalid
// create-world, run, pause, step, set-speed with arbitrary integers, submit with
// arbitrary strings), interleaved with any number of fired frames and issued in
// any Run_State including no-world, the controller posts exactly one `reply` per
// request, the reply ids equal the request ids in the same order, and every
// snapshot in every posted message has `tick` either null (only when no world
// exists) or a decimal string without leading zeros, and `checksum` either null
// or 16 lowercase hexadecimal characters.
//
// The controller runs the real WasmSim from target/wasm-pkg (loaded by the wasm
// helper), with a hand-driven FakeFrameScheduler and FakeClock and a
// messageCollector for `post` (R6.6). A generated command sequence (gen.ts
// commandsArb) drives it: every command that maps to a protocol request is sent
// through handle() with a strictly increasing id, and `fire-frames` commands fire
// frames on the fake scheduler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SimController } from '../../src/worker/controller.ts';
import type { Request, WorkerMessage } from '../../src/shared/protocol.ts';
import { createSim, loadWasm } from './helpers/wasm.ts';
import { FakeClock, FakeFrameScheduler, messageCollector } from './helpers/fakes.ts';
import { commandsArb, type Command } from './helpers/gen.ts';

const RUNS = 1000;

/** A reply message (ok true or false), narrowed from WorkerMessage. */
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

/** A decimal string with no leading zeros: "0" alone, or a non-zero leading digit. */
const DECIMAL_NO_LEADING_ZERO = /^(0|[1-9][0-9]*)$/;
/** Exactly 16 lowercase hexadecimal characters. */
const CHECKSUM_16_LOWER_HEX = /^[0-9a-f]{16}$/;

/** Assert a posted message's snapshot has well-formed tick and checksum fields (R2.5). */
function assertSnapshotWellFormed(m: WorkerMessage, context: string): void {
  if (m.type === 'fatal') {
    return; // fatal carries no snapshot
  }
  const { tick, checksum } = m.snapshot;
  // tick: null (only when no world) or a decimal string without leading zeros.
  if (tick !== null) {
    assert.match(tick, DECIMAL_NO_LEADING_ZERO, `${context}: tick not a clean decimal string: ${JSON.stringify(tick)}`);
  }
  // checksum: null or 16 lowercase hex characters.
  if (checksum !== null) {
    assert.match(
      checksum,
      CHECKSUM_16_LOWER_HEX,
      `${context}: checksum not 16 lowercase hex: ${JSON.stringify(checksum)}`,
    );
  }
}

/** Assert a reply is a well-formed member of the protocol reply union (R2.4, R2.7). */
function assertReplyWellFormed(reply: ReplyMessage): void {
  assert.equal(reply.type, 'reply');
  assert.equal(typeof reply.id, 'number');
  assert.ok(reply.snapshot !== null && typeof reply.snapshot === 'object', 'reply carries a snapshot');
  if (reply.ok === true) {
    // ok: true -> snapshot only, no error fields.
    assert.ok(!('kind' in reply), 'ok reply has no kind');
    assert.ok(!('error' in reply), 'ok reply has no error');
  } else {
    // ok: false -> kind + error + snapshot.
    assert.equal(reply.ok, false);
    assert.equal(typeof (reply as { kind: unknown }).kind, 'string', 'failure reply has an ErrorKind');
    assert.equal(typeof (reply as { error: unknown }).error, 'string', 'failure reply has error text');
  }
}

/**
 * Build a controller over the real WasmSim with hand-driven fakes, run a command
 * sequence through it, and return the collected messages plus the list of request
 * ids that were sent via handle(), in send order.
 */
function runCommands(commands: readonly Command[]): { messages: WorkerMessage[]; sentIds: number[] } {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post, messages } = messageCollector<WorkerMessage>();

  const controller = new SimController({ createSim, scheduler, clock, post });
  // The WASM is loaded synchronously in Node; mark the controller ready so
  // requests dispatch immediately and in order (the worker entry calls ready()
  // after init()).
  controller.ready();

  const sentIds: number[] = [];
  let nextId = 1;

  for (const cmd of commands) {
    if (cmd.kind === 'fire-frames') {
      // Advancing the clock a little per frame keeps status throttling realistic;
      // it never reaches the simulation (R6.5), only pacing and tps.
      for (let i = 0; i < cmd.count; i++) {
        clock.advance(16);
        scheduler.flush();
      }
      continue;
    }
    const id = nextId++;
    const req = toRequest(cmd, id);
    sentIds.push(id);
    controller.handle(req);
  }

  return { messages, sentIds };
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

// Property 2: exactly one well-formed reply per request, replies in request order,
// status messages are not replies, and every snapshot is well-formed.
test('controller posts exactly one well-formed reply per request, in order', () => {
  // Load once up front so the first property run is not timed out by WASM init.
  loadWasm();

  fc.assert(
    fc.property(commandsArb(), (commands) => {
      const { messages, sentIds } = runCommands(commands);

      const replies = messages.filter((m): m is ReplyMessage => m.type === 'reply');

      // Exactly one reply per request: counts match and the id multiset matches.
      assert.equal(
        replies.length,
        sentIds.length,
        `expected one reply per request: ${sentIds.length} requests, ${replies.length} replies`,
      );

      // Reply ids equal the request ids in the same order (R2.7). Because ids are
      // strictly increasing per request and each request gets exactly one reply,
      // the reply id sequence must equal the sent id sequence exactly.
      const replyIds = replies.map((r) => r.id);
      assert.deepEqual(replyIds, sentIds, 'reply ids must match request ids in send order');

      // Exactly one reply carries each sent id (no id replied twice, none missing).
      const seen = new Set<number>();
      for (const r of replies) {
        assert.ok(!seen.has(r.id), `id ${r.id} replied more than once`);
        seen.add(r.id);
      }
      for (const id of sentIds) {
        assert.ok(seen.has(id), `no reply for request id ${id}`);
      }

      // Each reply is a well-formed member of the reply union (R2.4).
      for (const r of replies) {
        assertReplyWellFormed(r);
      }

      // status messages are posted (unsolicited) but are never counted as replies:
      // they carry no id and are excluded from `replies` by their type (R2.7).
      for (const m of messages) {
        if (m.type === 'status') {
          assert.ok(!('id' in m), 'status messages carry no request id');
        }
      }

      // Every snapshot in every posted message (replies and statuses) is
      // well-formed: tick null or clean decimal, checksum null or 16 lower hex
      // (R2.5).
      messages.forEach((m, i) => assertSnapshotWellFormed(m, `message #${i} (${m.type})`));
    }),
    { numRuns: RUNS },
  );
});
