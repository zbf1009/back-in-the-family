import type { PlayerNode } from '../shared/world-snapshot.ts';
import type { AdmittedChoiceContext } from './life-context.ts';
import { renderStoryChronicle } from './journal-templates.ts';
import { chronicleForNode, currentLifePhase, entryContext } from './life-journal.ts';
import type { UiState } from './ui-state.ts';
import { TECHNICAL_TEXT } from './technical-text.ts';

/** The answering body and names are captured before transport can outlive that life. */
export interface ChoiceCapture extends AdmittedChoiceContext {
  node: PlayerNode;
}

export interface ChoiceResultView {
  requestId: number;
  node: string;
  kind: 'filed' | 'result';
  text: string;
}

/** Admission is not application; only the exact native Chronicle replaces the transition. */
export function choiceResult(ui: UiState): ChoiceResultView | null {
  const phase = currentLifePhase(ui.notebook, ui.world);
  for (let index = ui.actions.length - 1; index >= 0; index--) {
    const action = ui.actions[index]!;
    if (action.worldId !== ui.worldId || action.requestId === null || action.choice === undefined
      || action.lifePhaseKey !== phase?.key || action.phase !== 'queued') continue;
    const node = action.choice.node.id;
    if (ui.world?.player_node !== null && ui.world?.player_node !== undefined && ui.world.player_node.id !== node) return null;
    const record = chronicleForNode(ui.notebook, node);
    if (record === null) return { requestId: action.requestId, node, kind: 'filed', text: TECHNICAL_TEXT.choiceFiled };
    const captured = entryContext(ui.notebook, `c:${record.index}`);
    return { requestId: action.requestId, node, kind: 'result', text: renderStoryChronicle(
      record, action.choice.actors,
      { playerSoul: action.choice.playerSoul, currentBody: action.choice.focus, dreams: ui.notebook.dreams,
        ...(captured === null ? {} : { formerBodies: captured.formerBodies, actorContext: captured.actorContext }) }) };
  }
  return null;
}
