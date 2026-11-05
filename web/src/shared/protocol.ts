// Worker_Protocol: the typed messages exchanged between the Main_Thread and the
// Sim_Worker. This module is imported by both sides (R2.4).

export type RunState = 'no-world' | 'paused' | 'running' | 'failed';

export type Request =
  | { type: 'create-world'; id: number; seed: string; config: string }
  | { type: 'run'; id: number }
  | { type: 'pause'; id: number }
  | { type: 'step'; id: number }
  | { type: 'set-speed'; id: number; speed: number }
  | { type: 'submit'; id: number; input: string };

export interface Snapshot {
  worldId: number;          // 0 = no world; +1 per successful create-world
  runState: RunState;
  tick: string | null;      // decimal string; null when no world
  checksum: string | null;  // 16 lowercase hex; null before the first tick of a world
  tps: number | null;       // null unless running for at least 1,000 ms
  speed: number;
}

export type ErrorKind =
  | 'sim-error'       // WasmSim constructor or submit threw
  | 'invalid-seed'
  | 'invalid-speed'
  | 'no-world'
  | 'invalid-state'   // step while running
  | 'load-failed';    // WASM did not load

export type WorkerMessage =
  | { type: 'reply'; id: number; ok: true; snapshot: Snapshot }
  | { type: 'reply'; id: number; ok: false; kind: ErrorKind; error: string; snapshot: Snapshot }
  | { type: 'status'; snapshot: Snapshot }
  | { type: 'fatal'; error: string };
