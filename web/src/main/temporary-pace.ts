import { DEFAULT_SPEED, FAST_FORWARD_SPEED, type Speed } from '../shared/speeds.ts';

export interface TemporaryPace {
  worldId: number;
  targetSpeed: Speed;
  phase: 'starting' | 'moving' | 'stopping' | 'restoring' | 'selecting';
  requestId: number | null;
  paused: boolean;
}
export interface PaceTransition { fastForward: TemporaryPace | null; speed: Speed }
export type PaceEvent = { worldId: number } & (
  | { kind: 'begin' | 'stop' | 'error' | 'cancel' | 'pause' | 'paused' | 'restore' | 'create-failed' | 'world-created' }
  | { kind: 'select'; speed: Speed }
  | { kind: 'request-sent' | 'accepted'; requestId: number }
);

/**
 * Presentation-only pace state. The existing owner still admits Run, handles stops
 * and reanchors its one loop. Pass its current accepted world, not a pending Create.
 */
export function transitionTemporaryPace(
  fastForward: TemporaryPace | null,
  worldId: number,
  speed: Speed,
  event: PaceEvent,
): PaceTransition {
  if (event.worldId !== worldId) return { fastForward, speed };
  if (event.kind === 'world-created') return { fastForward: null, speed: DEFAULT_SPEED };
  if (event.kind === 'begin') return fastForward === null
    ? { fastForward: { worldId, targetSpeed: speed, phase: 'starting', requestId: null, paused: false }, speed: FAST_FORWARD_SPEED }
    : { fastForward, speed };
  if (fastForward?.worldId !== worldId) return { fastForward, speed: event.kind === 'select' ? event.speed : speed };
  switch (event.kind) {
    case 'create-failed': return { fastForward, speed };
    case 'select': return { fastForward: { ...fastForward, targetSpeed: event.speed, phase: 'selecting', requestId: null }, speed: event.speed };
    case 'request-sent': return { fastForward: { ...fastForward, requestId: event.requestId }, speed };
    case 'accepted':
      if (fastForward.requestId !== event.requestId) return { fastForward, speed };
      if (fastForward.phase === 'restoring' || fastForward.phase === 'selecting') return { fastForward: null, speed };
      return { fastForward: { ...fastForward, phase: fastForward.phase === 'starting' ? 'moving' : 'restoring', requestId: null },
        speed: fastForward.phase === 'stopping' ? fastForward.targetSpeed : speed };
    case 'restore': return { fastForward: { ...fastForward, phase: 'restoring', requestId: null }, speed: fastForward.targetSpeed };
    case 'paused': return { fastForward: { ...fastForward, paused: true }, speed };
    case 'stop': case 'pause':
      if (fastForward.phase === 'selecting') return {
        fastForward: { ...fastForward, paused: fastForward.paused || event.kind === 'stop' }, speed: fastForward.targetSpeed,
      };
      return { fastForward: { ...fastForward, phase: 'stopping', requestId: null,
        paused: fastForward.paused || event.kind === 'stop' }, speed: fastForward.targetSpeed };
    case 'error': case 'cancel':
      return { fastForward: { ...fastForward, phase: 'stopping', requestId: null }, speed: fastForward.targetSpeed };
  }
}
