// Worker_Protocol: the typed messages exchanged between the Main_Thread and the
// Sim_Worker. This module is imported by both sides (R2.4).
import type { ActionResult, CoreActionResult, PlayerLifecycleFact, PlayerOption, Slot, SubmissionReceipt, TraitName, WorldSnapshot } from './world-snapshot.ts';
import type { DecisionFallbackReason, DecisionSessionStatus, DecisionUsage } from './decision.ts';
import type { DecisionMetricsReport } from './decision-metrics.ts';

export type DecisionPreviewError = { kind: 'malformed' | 'no_node' } | { kind: 'rejected'; reason: string };
export type DecisionNotice = { requestId: number; worldId: number } & (
  | { kind: 'model'; option: string; usage: DecisionUsage | null }
  | { kind: 'fallback'; reason: DecisionFallbackReason | 'manual' }
  | { kind: 'cancelled' });
export interface DecisionStatus extends DecisionSessionStatus {
  pending: { requestId: number; worldId: number; tick: string; trigger: string | null } | null;
  outcome: DecisionNotice | null;
}

export type RunState = 'no-world' | 'paused' | 'running' | 'failed';

export type PauseReason = 'player_node' | 'player_died' | 'dream_resolved' | 'player_reborn' | 'user';
export interface StopPayload { reasons: PauseReason[]; world: WorldSnapshot }
export interface RunUntilStopResult {
  ran: number; checksum: string; stops: Exclude<PauseReason, 'user'>[];
  actions: CoreActionResult[]; player_lifecycle: PlayerLifecycleFact[];
}
export type PlayerNodeState = { pending: false } | { pending: true; node: string; answered: boolean };
export type CheckedSubmission = ({ ok: true } & SubmissionReceipt) | { ok: false; index: number; reason: string };
export const DREAM_INTENTS = ['warn', 'reassure', 'urge', 'reveal', 'request_offering', 'forbid'] as const;
export type DreamIntent = typeof DREAM_INTENTS[number];
// Customization retains the v5 payload's shape; only the controller builds JSON.
export type Customization =
  | { Set: { trait_name: TraitName; value: number } }
  | { Adjust: { first: { trait_name: TraitName; delta: -1 | 1 }; second: { trait_name: TraitName; delta: -1 | 1 } } };

export type Request =
  | { type: 'create-world'; id: number; seed: string; config: string }
  | { type: 'run'; id: number }
  | { type: 'pause'; id: number }
  | { type: 'step'; id: number }
  | { type: 'set-speed'; id: number; speed: number }
  | { type: 'submit'; id: number; input: string }
  | { type: 'world-snapshot'; id: number }
  | { type: 'choose'; id: number; node: string; option: PlayerOption }
  | { type: 'choose-and-run'; id: number; node: string; option: PlayerOption }
  | { type: 'dream'; id: number; dreamer: number; intent: DreamIntent }
  | { type: 'bribe'; id: number; amount: string }
  | { type: 'haunt'; id: number; target: number }
  | { type: 'carry-over'; id: number; trait: TraitName }
  | { type: 'decision-status'; id: number }
  | { type: 'decision-metrics'; id: number }
  | { type: 'set-decision-wait'; id: number; seconds: number }
  | { type: 'use-rules-now'; id: number; requestId: number; worldId: number }
  | { type: 'export-replay'; id: number }
  | { type: 'claim'; id: number; slot: Exclude<Slot, 'rebuilt_body'>; carryOver: TraitName | null; customization?: never }
  | { type: 'claim'; id: number; slot: 'rebuilt_body'; carryOver: TraitName | null; customization: Customization }
  | { type: 'checksums'; id: number; from: string; to: string }
  | { type: 'player_node_state'; id: number };

export type RequestWithoutId = Request extends infer R ? R extends Request ? Omit<R, 'id'> : never : never;

export interface Snapshot {
  worldId: number;          // 0 = no world; +1 per successful create-world
  runState: RunState;
  tick: string | null;      // decimal string; null when no world
  checksum: string | null;  // 16 lowercase hex; null before the first tick of a world
  tps: number | null;       // null unless running for at least 1,000 ms
  speed: number;
  playerNode: PlayerNodeState; // input-stream-backed read; present on every reply/status
  actions: ActionResult[];
  playerLifecycle: PlayerLifecycleFact[];
  decision?: DecisionStatus; // orthogonal to Run_State and simulation stop reasons
  stop?: StopPayload;       // present only on the message reporting that pause
}

export type ErrorKind =
  | 'sim-error'       // WasmSim constructor or submit threw
  | 'invalid-seed'
  | 'invalid-speed'
  | 'invalid-tick'    // checksum history index is not a decimal u64
  | 'no-world'
  | 'invalid-state'   // step while running
  | 'load-failed'     // WASM did not load
  | 'rejected'        // checked submission's rejection label is in error
  | 'node_unanswered'
  | 'decision_pending'
  | 'invalid-wait'
  | 'preview-error'
  | 'cancelled';

export type Reply =
  | { type: 'reply'; id: number; ok: true; snapshot: Snapshot; submission?: SubmissionReceipt; world?: WorldSnapshot; checksums?: string[]; replay?: string; metrics?: DecisionMetricsReport | null }
  | { type: 'reply'; id: number; ok: false; kind: ErrorKind; error: string; snapshot: Snapshot; world?: WorldSnapshot; previewError?: DecisionPreviewError };
export interface Status { type: 'status'; snapshot: Snapshot }
export type WorkerMessage = Reply | Status | { type: 'fatal'; error: string };

export interface RequestTicket { requestId: number; reply: Promise<Reply> }
