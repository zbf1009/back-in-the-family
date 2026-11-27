import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neededText, nameLabel, refusalText, transportText } from '../../src/main/player-copy.ts';
import { dateLabel, formatAmount } from '../../src/main/calendar.ts';
import type { ErrorKind } from '../../src/shared/protocol.ts';

test('actual names are preserved; genuinely missing names never become invented people', () => {
  const actual = 'Nadine Bradley';
  assert.equal(nameLabel(actual), actual);
  assert.equal(nameLabel(undefined), 'Name unavailable');
  assert.equal(nameLabel(null), 'Name unavailable');
  assert.equal(nameLabel(''), 'Name unavailable');
  assert.equal(nameLabel('  '), 'Name unavailable');
});

test('transport diagnostics and unknown named requirements never leak as player explanations', () => {
  const diagnostic = 'Person 42 node=18446744073709551615 unknown_wire_condition';
  for (const kind of [
    'sim-error', 'invalid-seed', 'invalid-speed', 'invalid-tick', 'no-world', 'invalid-state',
    'load-failed', 'rejected', 'node_unanswered', 'decision_pending', 'invalid-wait', 'preview-error', 'cancelled',
  ] satisfies ErrorKind[]) {
    const text = transportText(kind, 'running', diagnostic);
    assert.ok(text.length > 0);
    assert.ok(!text.includes(diagnostic));
    assert.ok(!text.includes('18446744073709551615'));
  }
  for (const reason of [diagnostic, 'toString', '__proto__', 'constructor']) {
    assert.equal(refusalText(reason), transportText('rejected', 'paused'));
    assert.equal(neededText({ kind: 'named', name: reason }), refusalText(reason));
  }
  assert.equal(transportText('rejected', 'paused', 'node_pending'), refusalText('node_pending'));
  assert.equal(transportText('sim-error', 'paused', diagnostic, 'create-world'), transportText('load-failed', 'paused'));
});

test('nonfatal failures do not claim a stop, while confirmed failed and fatal states do', () => {
  const stopped = transportText('fatal', 'failed');
  for (const runState of ['running', 'paused'] as const) {
    assert.notEqual(transportText('sim-error', runState, 'ticket timeout', 'set-speed'), stopped);
    assert.equal(transportText('sim-error', 'failed', 'ticket timeout', 'set-speed'), stopped);
    assert.equal(transportText('fatal', runState, 'worker stopped'), stopped);
  }
});

test('Needed keeps exact date and payment role, including a reservation in your name', () => {
  const amount = '18446744073709551615';
  assert.ok(neededText({ kind: 'wait_until', tick: amount }).includes(dateLabel(amount)));
  assert.ok(neededText({ kind: 'joss_short', amount }).includes(formatAmount(amount)));
  assert.ok(neededText({ kind: 'cap_room_short', amount }).includes(formatAmount(amount)));
  assert.equal(neededText({ kind: 'named', name: 'claimed_by_you' }), refusalText('claimed_by_you'));
  assert.notEqual(refusalText('claimed_by_you'), refusalText('slot_claimed'));
});
