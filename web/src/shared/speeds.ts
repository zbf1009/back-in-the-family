// Speed is a playback multiplier; wall-time pacing is independent of refresh rate.

export const PLAY_RATE = 30;

// Literal decimal values keep Speed a closed union; these equal 1/30 and 1/6.
export const READ_SPEED = 0.03333333333333333;
export const LIFE_SPEED = 0.16666666666666666;
export const DEFAULT_SPEED = LIFE_SPEED;
export const FAST_FORWARD_SPEED = 30;

export const SPEEDS = [READ_SPEED, LIFE_SPEED, 1, 7, 30, 90, 365] as const;

export type Speed = (typeof SPEEDS)[number];

/** True when `n` is one of the SPEEDS values. Used to validate set-speed (R4.11, R6.3). */
export function isSpeed(n: number): n is Speed {
  return (SPEEDS as readonly number[]).includes(n);
}
