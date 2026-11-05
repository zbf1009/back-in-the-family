// Event bridge between the SimClient handlers and the mounted App (R2.8, R2.9, R2.12).
//
// The SimClient's worker-initiated handlers (onStatus / onFatal / onError) are
// fixed at construction, which happens in main.ts before App mounts. The App,
// however, owns the UiState and the reducer. This one-field holder bridges the
// two: main.ts constructs the client with handlers that forward through the
// bridge, and App points `bridge.dispatch` at its reducer while it is mounted.
// Before the App mounts (or after it unmounts) `dispatch` is `null` and events
// are dropped, which only happens before the page is interactive.

import type { UiEvent } from './ui-state.ts';

/** A mutable holder for the App's event dispatcher. One per page, shared by value. */
export interface EventBridge {
  /** The mounted App's reducer entry point, or `null` before it mounts. */
  dispatch: ((event: UiEvent) => void) | null;
}

/** Create an empty bridge. main.ts passes the same instance to the client and to App. */
export function createBridge(): EventBridge {
  return { dispatch: null };
}
