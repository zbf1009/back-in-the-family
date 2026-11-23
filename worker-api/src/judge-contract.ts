export type Quota = {
  utc_day: string;
  reset_at_ms: number;
  daily_limit: 40;
  daily_remaining: number;
  session_limit: 10;
  session_remaining: number;
};
export type JudgeSession =
  | { version: 'judge-session-v1'; state: 'anonymous'; expires_at_ms: null; quota: null }
  | { version: 'judge-session-v1'; state: 'active'; expires_at_ms: number; quota: Quota };
export type ActiveJudgeSession = Extract<JudgeSession, { state: 'active' }>;
export type JudgeOpen = { session: ActiveJudgeSession; reused: boolean };
export type JudgeReservation =
  | { kind: 'admitted'; quota: Quota }
  | { kind: 'anonymous' }
  | { kind: 'rate_limited'; quota: Quota };

/** Internal hash-only RPC wire, independent of native binding and runtime types. */
export interface JudgeRPC {
  status(token_sha256: string | null, code_epoch: string): Promise<JudgeSession>;
  open(candidate_sha256: string, existing_sha256: string | null, code_epoch: string): Promise<JudgeOpen>;
  revoke(token_sha256: string | null): Promise<void>;
  reserve(token_sha256: string, code_epoch: string): Promise<JudgeReservation>;
}
