// Speed: the number of ticks the Sim_Worker runs per Frame while running, chosen
// from a fixed list (R4.4). The values are one day, week, month, quarter and
// year. All are within u32, so they are legal tick counts for run_ticks (R6.3).

export const SPEEDS = [1, 7, 30, 90, 365] as const;

export type Speed = (typeof SPEEDS)[number];

/** True when `n` is one of the SPEEDS values. Used to validate set-speed (R4.11, R6.3). */
export function isSpeed(n: number): n is Speed {
  return (SPEEDS as readonly number[]).includes(n);
}
