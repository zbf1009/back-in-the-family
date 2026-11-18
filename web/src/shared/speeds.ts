// Speed is a playback multiplier; wall-time pacing is independent of refresh rate.

export const PLAY_RATE = 30;

export const SPEEDS = [1, 7, 30, 90, 365] as const;

export type Speed = (typeof SPEEDS)[number];

/** True when `n` is one of the SPEEDS values. Used to validate set-speed (R4.11, R6.3). */
export function isSpeed(n: number): n is Speed {
  return (SPEEDS as readonly number[]).includes(n);
}
