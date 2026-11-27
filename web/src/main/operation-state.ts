import type { OperationState } from '../shared/operation-state.ts';
import type { Request } from '../shared/protocol.ts';
import type { UiState } from './ui-state.ts';
import { currentLifePhase } from './life-journal.ts';
import { choiceResult } from './choice-result.ts';

function operationKind(type: Request['type']): OperationState['kind'] | null {
  switch (type) {
    case 'choose': case 'choose-and-run': return 'choose';
    case 'dream': case 'bribe': case 'haunt': case 'carry-over': case 'claim': return type;
    default: return null;
  }
}

/** Only exact same-world result/sequence joins upgrade an admission receipt. */
export function operationStates(ui: UiState): OperationState[] {
  const states: OperationState[] = [];
  const phaseKey = currentLifePhase(ui.notebook, ui.world)?.key;
  const choice = choiceResult(ui);
  for (const action of ui.actions) {
    if (action.worldId !== ui.worldId || action.requestId === null || action.request === null) continue;
    if (action.lifePhaseKey !== phaseKey || choice?.kind === 'result' && action.requestId === choice.requestId) continue;
    const kind = operationKind(action.request.type);
    if (kind === null) continue;
    const inputSeqs = action.submission?.seqs ?? (action.inputSeq === null ? [] : [action.inputSeq]);
    const result = action.result?.worldId === ui.worldId ? action.result : undefined;
    const dream = kind === 'dream' ? action.dream : undefined;
    let phase: OperationState['phase'];
    if (result?.state === 'rejected') phase = 'refused';
    else if (result?.state === 'applied' || dream !== undefined) phase = 'processed';
    else {
      switch (action.phase) {
        case 'sending': phase = 'sending'; break;
        case 'deciding': phase = 'considering'; break;
        case 'queued': case 'applied': phase = 'received'; break;
        case 'unknown': phase = 'unknown'; break;
        case 'rejected': phase = 'refused'; break;
        case 'cancelled': phase = 'cancelled'; break;
      }
    }
    states.push({ worldId: action.worldId, requestId: action.requestId, kind, phase, inputSeqs,
      asOf: result?.tick ?? dream?.tick ?? action.submission?.tick ?? ui.world?.tick ?? ui.tick,
      refusalStage: phase === 'refused' ? result?.state === 'rejected' ? 'processing' : 'admission' : null,
      ...(result?.state === 'rejected' ? { reason: result.reason } : action.error === null ? {} : { reason: action.error }),
      ...(result === undefined ? {} : { result }), ...(dream === undefined ? {} : { dream }) });
  }
  return states;
}
