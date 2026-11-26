import { DEFAULT_SPEED, FAST_FORWARD_SPEED, type Speed } from '../shared/speeds.ts';

export interface TemporaryPace { worldId: number; previousSpeed: Speed }
export interface PaceTransition { fastForward: TemporaryPace | null; speed: Speed }
export type PaceEvent = { worldId: number } & (
  | { kind: 'begin' | 'stop' | 'error' | 'cancel' | 'pause' | 'create-failed' | 'world-created' }
  | { kind: 'select'; speed: Speed }
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
  switch (event.kind) {
    case 'world-created': return { fastForward: null, speed: DEFAULT_SPEED };
    case 'create-failed': return { fastForward, speed };
    case 'select': return { fastForward: null, speed: event.speed };
    case 'begin':
      return {
        fastForward: fastForward?.worldId === worldId ? fastForward : { worldId, previousSpeed: speed },
        speed: FAST_FORWARD_SPEED,
      };
    case 'stop': case 'error': case 'cancel': case 'pause':
      return fastForward?.worldId === worldId
        ? { fastForward: null, speed: fastForward.previousSpeed }
        : { fastForward, speed };
  }
}
