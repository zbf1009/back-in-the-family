// Placement detection (design: Placement detection; R9.1, R10.6).
//
// ONNX Runtime log format, read from onnxruntime/core/framework/session_state.cc
// (`VerifyEachNodeIsAssignedToAnEp`, verbose severity only):
//
//   Node placements
//    All nodes placed on [<provider>]. Number of nodes: <n>            (one provider)
//   -- or, with several providers, per provider:
//    Node(s) placed on [<provider>]. Number of nodes: <n>
//     <OpType> (<node name>)                                           (one line per node)
//
// Each line may carry ORT's own prefix, e.g. `[V:onnxruntime:, session_state.cc:1598 ...] `.
// The per-node op-type lines exist only in the multi-provider form, which is also the only form
// in which CPU-placed nodes can appear next to WebGPU nodes. Confirmed against a real capture on
// 2026-11-07 (task 15.6 / V6, transformers.js 4.3.2, Chrome 155): tests/unit/fixtures/ort-placement-qwen3.5-0.8b.txt.

export type PlacementMethod = 'webllm_model_lib' | 'onnxruntime_node_placements';

export interface CpuNode {
  readonly op_type: string;
  readonly count: number;
}

/** The R9.1 record that goes into the Results header. */
export interface Placement {
  readonly method: PlacementMethod;
  readonly cpu_nodes: readonly CpuNode[];
}

export type PlacementResult =
  | { readonly ok: true; readonly placement: Placement }
  | { readonly ok: false; readonly code: 'placement_not_logged' | 'backend_not_webgpu'; readonly detail: string };

/** WebLLM: the forward pass is a TVM-compiled WebGPU module with no CPU kernels. */
export const WEBLLM_PLACEMENT: Placement = Object.freeze({ method: 'webllm_model_lib', cpu_nodes: Object.freeze([]) as readonly CpuNode[] });

/**
 * Shape and index computation (Author, 2026-11-07): operators ONNX Runtime places on the CPU on purpose for small
 * shape/index tensors. Cheap; listed apart in the Report. Classified by operator type only.
 */
export const SHAPE_OPS: ReadonlySet<string> = new Set([
  'Shape', 'Size', 'Gather', 'Unsqueeze', 'Squeeze', 'Cast', 'Concat', 'Slice', 'Range', 'Reshape', 'Expand',
  'ConstantOfShape', 'Equal', 'Less', 'Greater', 'Where', 'Neg', 'Sub', 'Add', 'Mul', 'Div', 'Min', 'Max',
]);

/** Splits CPU-placed nodes into shape computation and compute operators (e.g. `Scan`), keeping the sort order. */
export function splitCpuNodes(nodes: readonly CpuNode[]): { readonly shape: readonly CpuNode[]; readonly compute: readonly CpuNode[] } {
  return { shape: nodes.filter((n) => SHAPE_OPS.has(n.op_type)), compute: nodes.filter((n) => !SHAPE_OPS.has(n.op_type)) };
}

export const isWebGpuProvider = (provider: string): boolean => provider === 'WebGpuExecutionProvider' || provider === 'JsExecutionProvider';
export const isCpuProvider = (provider: string): boolean => provider === 'CPUExecutionProvider';

interface Block {
  providers: Map<string, number>;
  cpuOps: Map<string, number>;
}

// Optional timestamp, then `[V:onnxruntime:<logger>, <file>:<line> <func>] `.
const ORT_PREFIX = /^\s*(?:\d{4}-\d{2}-\d{2}[ T][\d:.]+\s+)?\[[VIWEF]:onnxruntime:[^\]]*\]\s?/;
const HEADER = /^\s*Node placements\s*$/;
const ALL_ON = /^\s*All nodes placed on \[([^\]]+)\]\. Number of nodes: (\d+)\s*$/;
const SOME_ON = /^\s*Node\(s\) placed on \[([^\]]+)\]\. Number of nodes: (\d+)\s*$/;
const NODE = /^\s*([A-Za-z_][A-Za-z0-9_.]*) \(.*\)\s*$/;

/**
 * Splits console text (each entry may hold several lines) into "Node placements" blocks and reads
 * the providers and the CPU-placed op types of each. Returns [] when no block was logged.
 */
function parseBlocks(consoleLines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let block: Block | null = null;
  let provider: string | null = null;
  for (const entry of consoleLines) {
    for (const rawLine of entry.split(/\r?\n/)) {
      const line = rawLine.replace(ORT_PREFIX, '');
      if (HEADER.test(line)) {
        block = { providers: new Map(), cpuOps: new Map() };
        blocks.push(block);
        provider = null;
        continue;
      }
      if (block === null) continue;
      const all = ALL_ON.exec(line);
      const some = all === null ? SOME_ON.exec(line) : null;
      const head = all ?? some;
      if (head !== null) {
        provider = head[1] as string;
        block.providers.set(provider, (block.providers.get(provider) ?? 0) + Number(head[2]));
        continue;
      }
      const node = provider !== null && isCpuProvider(provider) ? NODE.exec(line) : null;
      if (node !== null) block.cpuOps.set(node[1] as string, (block.cpuOps.get(node[1] as string) ?? 0) + 1);
    }
  }
  return blocks;
}

/**
 * Placement of a transformers.js run from the captured page-console lines. One model may create
 * several sessions, each logging its own block; CPU op counts are summed across blocks.
 * - no block: `placement_not_logged` (R10.6);
 * - no block places any node on the WebGPU provider: `backend_not_webgpu` (R10.6);
 * - otherwise the CPU-placed op types are flagged, not failed (R9.1), sorted by op type.
 */
export function parsePlacement(consoleLines: readonly string[]): PlacementResult {
  const blocks = parseBlocks(consoleLines);
  if (blocks.length === 0) return { ok: false, code: 'placement_not_logged', detail: 'no "Node placements" block in the console log' };
  const anyWebGpu = blocks.some((b) => [...b.providers.entries()].some(([p, n]) => isWebGpuProvider(p) && n > 0));
  if (!anyWebGpu) {
    const seen = [...new Set(blocks.flatMap((b) => [...b.providers.keys()]))].sort();
    return { ok: false, code: 'backend_not_webgpu', detail: `no node placed on WebGPU; providers logged: ${seen.join(', ') || 'none'}` };
  }
  const total = new Map<string, number>();
  for (const b of blocks) for (const [op, n] of b.cpuOps) total.set(op, (total.get(op) ?? 0) + n);
  const cpu_nodes = [...total.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([op_type, count]) => ({ op_type, count }));
  return { ok: true, placement: { method: 'onnxruntime_node_placements', cpu_nodes } };
}
