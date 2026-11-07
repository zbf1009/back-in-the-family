// Gap-filling examples for the placement parser (task 16.4; R9.1, R10.6).
// placement.test.ts already covers: the mixed WebGPU+CPU sample, summing across blocks, the plain
// no-prefix form, placement_not_logged, all-CPU backend_not_webgpu and the WebLLM record.
// Everything below is HAND-BUILT from onnxruntime/core/framework/session_state.cc, not a real capture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlacement } from '../../src/adapters/placement.ts';

const body = (p: string): string[] => [
  `${p}Node placements`,
  `${p} Node(s) placed on [CPUExecutionProvider]. Number of nodes: 4`,
  `${p}  Shape (/a)`,
  `${p}  Cast (/b)`,
  `${p}  Shape (/c)`,
  `${p}  Cast (/d)`,
  `${p} Node(s) placed on [WebGpuExecutionProvider]. Number of nodes: 80`,
];
const expected = {
  ok: true,
  placement: { method: 'onnxruntime_node_placements', cpu_nodes: [{ op_type: 'Cast', count: 2 }, { op_type: 'Shape', count: 2 }] },
};

test('ORT log prefix variants all parse to the same result (hand-built)', () => {
  for (const p of [
    '',
    '[V:onnxruntime:, session_state.cc:1598 VerifyEachNodeIsAssignedToAnEp] ',
    '[V:onnxruntime:Default, session_state.cc:1598 VerifyEachNodeIsAssignedToAnEp] ',
    '2025-01-02 03:04:05.678 [V:onnxruntime:, session_state.cc:1598 X] ',
    '[I:onnxruntime:sess, a.cc:1 f] ',
  ]) {
    assert.deepEqual(parsePlacement(body(p)), expected, JSON.stringify(p));
  }
});

test('cpu_nodes order does not depend on log order (hand-built)', () => {
  const lines = body('');
  const reversed = [lines[0] as string, lines[1] as string, ...lines.slice(2, 6).reverse(), lines[6] as string];
  assert.deepEqual(parsePlacement(reversed), expected);
});

test('only a non-WebGPU provider other than CPU is backend_not_webgpu', () => {
  const r = parsePlacement(['Node placements', ' All nodes placed on [XnnpackExecutionProvider]. Number of nodes: 9']);
  assert.equal(r.ok === false && r.code, 'backend_not_webgpu');
});

test('FIXTURE SLOT: real captured ONNX Runtime sample from task 15.6 goes here', { todo: 'task 15.6 adds a real capture; none exists yet' }, () => {
  // const real: string[] = [...]; assert.equal(parsePlacement(real).ok, true);
});
