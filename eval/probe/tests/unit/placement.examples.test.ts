// Gap-filling examples for the placement parser (task 16.4; R9.1, R10.6).
// placement.test.ts already covers: the mixed WebGPU+CPU sample, summing across blocks, the plain
// no-prefix form, placement_not_logged, all-CPU backend_not_webgpu and the WebLLM record.
// The tests above the real-capture test are HAND-BUILT from onnxruntime/core/framework/session_state.cc.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parsePlacement, splitCpuNodes } from '../../src/adapters/placement.ts';

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

// REAL capture (task 15.6 / V6, 2026-11-07): the "Node placements" lines ONNX Runtime Web (bundled in
// transformers.js 4.3.2) printed on the page console when onnx-community/Qwen3.5-0.8B-ONNX (q4, WebGPU, headless
// system Chrome 155, NVIDIA adapter) was loaded with logSeverityLevel 0 and env.backends.onnx.logLevel 'verbose'.
// Two sessions logged a block: a 1-node session (all on WebGPU) and the 3,284-node decoder. Excerpt: only the
// first 22 of the decoder's 3,048 WebGPU node lines are kept (the parser counts CPU nodes only); every other line,
// including all 236 CPU node lines, is verbatim. Graph node names and operator types only; no prompt or output.
test('real ONNX Runtime Web placement block (Qwen3.5-0.8B, 2026-11-07) parses to 236 CPU nodes', () => {
  const real = readFileSync(new URL('./fixtures/ort-placement-qwen3.5-0.8b.txt', import.meta.url), 'utf8').split('\n');
  const r = parsePlacement(real);
  assert.deepEqual(r, {
    ok: true,
    placement: {
      method: 'onnxruntime_node_placements',
      cpu_nodes: [
        { op_type: 'Cast', count: 22 },
        { op_type: 'Concat', count: 15 },
        { op_type: 'Equal', count: 18 },
        { op_type: 'Expand', count: 1 },
        { op_type: 'Gather', count: 64 },
        { op_type: 'Mul', count: 12 },
        { op_type: 'Neg', count: 18 },
        { op_type: 'Range', count: 12 },
        { op_type: 'Reshape', count: 12 },
        { op_type: 'Scan', count: 18 },
        { op_type: 'Shape', count: 2 },
        { op_type: 'Slice', count: 18 },
        { op_type: 'Sub', count: 1 },
        { op_type: 'Unsqueeze', count: 23 },
      ],
    },
  });
  assert.equal(r.ok && r.placement.cpu_nodes.reduce((n, c) => n + c.count, 0), 236);
});

test('splitCpuNodes: Scan is a compute operator, the shape ops of the real capture are shape computation', () => {
  const real = readFileSync(new URL('./fixtures/ort-placement-qwen3.5-0.8b.txt', import.meta.url), 'utf8').split('\n');
  const r = parsePlacement(real);
  assert.ok(r.ok);
  const { shape, compute } = splitCpuNodes(r.placement.cpu_nodes);
  assert.deepEqual(compute, [{ op_type: 'Scan', count: 18 }]);
  assert.equal(shape.reduce((n, c) => n + c.count, 0), 218);
});
