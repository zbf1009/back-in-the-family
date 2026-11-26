import type { ActionResult } from './world-snapshot.ts';
import type { DreamFact } from './story.ts';

/** Presentation of one exact receipt; current World facts cannot upgrade it. */
export interface OperationState {
  worldId: number;
  requestId: number;
  kind: 'choose' | 'dream' | 'bribe' | 'haunt' | 'carry-over' | 'claim';
  phase: 'sending' | 'considering' | 'received' | 'unknown' | 'processed' | 'refused' | 'cancelled';
  asOf: string | null;
  inputSeqs: readonly string[];
  refusalStage: 'admission' | 'processing' | null;
  reason?: string;
  result?: ActionResult;
  dream?: DreamFact;
}
