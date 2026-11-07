import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlacement, WEBLLM_PLACEMENT } from '../../src/adapters/placement.ts';

// Hand-written from the format in onnxruntime/core/framework/session_state.cc (not a real capture).
const P = '[V:onnxruntime:, session_state.cc:1598 VerifyEachNodeIsAssignedToAnEp] ';
const multi = [
  `${P}Node placements`,
  `${P} Node(s) placed on [CPUExecutionProvider]. Number of nodes: 3`,
  `${P}  Shape (/model/Shape)`,
  `${P}  Gather (/model/Gather)`,
  `${P}  Shape (/model/Shape_1)`,
  `${P} Node(s) placed on [WebGpuExecutionProvider]. Number of nodes: 120`,
  `${P}  MatMulNBits (/model/mm0)`,
];

test('multi-provider block: CPU op types counted and sorted, WebGPU nodes ignored', () => {
  const r = parsePlacement(multi);
  assert.deepEqual(r, { ok: true, placement: { method: 'onnxruntime_node_placements', cpu_nodes: [{ op_type: 'Gather', count: 1 }, { op_type: 'Shape', count: 2 }] } });
});

test('lines may arrive in one console entry, without the ORT prefix', () => {
  const r = parsePlacement(['Node placements\n Node(s) placed on [CPUExecutionProvider]. Number of nodes: 1\n  Cast (c)\n Node(s) placed on [WebGpuExecutionProvider]. Number of nodes: 9']);
  assert.equal(r.ok && r.placement.cpu_nodes[0]?.op_type, 'Cast');
});

test('all nodes on WebGPU gives an empty cpu_nodes list', () => {
  const r = parsePlacement([`${P}Node placements`, `${P} All nodes placed on [WebGpuExecutionProvider]. Number of nodes: 50`]);
  assert.deepEqual(r, { ok: true, placement: { method: 'onnxruntime_node_placements', cpu_nodes: [] } });
});

test('counts are summed across several session blocks', () => {
  const r = parsePlacement([...multi, ...multi]);
  assert.equal(r.ok && r.placement.cpu_nodes.find((n) => n.op_type === 'Shape')?.count, 4);
});

test('no placement block is placement_not_logged', () => {
  assert.deepEqual(parsePlacement(['[W:onnxruntime] something else', 'Shape (x)']), { ok: false, code: 'placement_not_logged', detail: 'no "Node placements" block in the console log' });
  assert.equal(parsePlacement([]).ok, false);
});

test('all nodes on another provider is backend_not_webgpu', () => {
  const r = parsePlacement([`${P}Node placements`, `${P} All nodes placed on [CPUExecutionProvider]. Number of nodes: 50`]);
  assert.equal(r.ok === false && r.code, 'backend_not_webgpu');
});

test('WebLLM record', () => {
  assert.deepEqual(WEBLLM_PLACEMENT, { method: 'webllm_model_lib', cpu_nodes: [] });
});
