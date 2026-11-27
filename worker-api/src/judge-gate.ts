import { DurableObject } from 'cloudflare:workers';
import { configuredCount } from './handler.ts';
import type { ActiveJudgeSession, JudgeOpen, JudgeReservation, JudgeRPC, JudgeSession, Quota } from './judge-contract.ts';
import type { ObituaryReservation } from '../../web/src/shared/obituary.ts';

export type JudgeEnv = JudgeBindings & { JUDGE_CODE?: string };

export function anonymousSession(): JudgeSession {
  return { version: 'judge-session-v1', state: 'anonymous', expires_at_ms: null, quota: null };
}

function requireHash(value: string | null, nullable = false): void {
  if ((nullable && value === null) || (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))) return;
  throw new Error('Judge gate unavailable');
}

type SessionRow = { expires_at_ms: number; admitted: number; code_epoch: string };

/** One stable SQLite coordination atom; no network I/O occurs in its transactions. */
export class JudgeGate extends DurableObject<JudgeEnv> implements JudgeRPC {
  constructor(ctx: DurableObjectState, env: JudgeEnv) {
    super(ctx, env);
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
        token_sha256 TEXT PRIMARY KEY,
        expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= 0),
        admitted INTEGER NOT NULL DEFAULT 0 CHECK(admitted BETWEEN 0 AND 10),
        code_epoch TEXT NOT NULL
      )`).toArray();
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS daily (
        utc_day TEXT PRIMARY KEY,
        admitted INTEGER NOT NULL DEFAULT 0 CHECK(admitted BETWEEN 0 AND 40)
      )`).toArray();
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS obituary_claims (
        token_sha256 TEXT NOT NULL,
        operation_key TEXT NOT NULL CHECK(length(operation_key) = 64 AND operation_key NOT GLOB '*[^0-9a-f]*'),
        PRIMARY KEY (token_sha256, operation_key)
      )`).toArray();
    });
  }

  #configured(): number {
    const ttl = configuredCount(this.env.JUDGE_SESSION_TTL_SECONDS);
    if (configuredCount(this.env.JUDGE_DAILY_CAP) !== 40
      || configuredCount(this.env.SESSION_CAP) !== 10 || ttl !== 86400) {
      throw new Error('Judge gate unavailable');
    }
    return ttl;
  }

  #session(token: string | null, epoch: string, now: number): SessionRow | null {
    this.ctx.storage.sql.exec(`DELETE FROM obituary_claims WHERE token_sha256 IN
      (SELECT token_sha256 FROM sessions WHERE expires_at_ms <= ?)`, now).toArray();
    if (token === null) return null;
    const row = this.ctx.storage.sql.exec<SessionRow>(
      'SELECT expires_at_ms, admitted, code_epoch FROM sessions WHERE token_sha256 = ?', token,
    ).toArray()[0];
    if (row === undefined || row.code_epoch !== epoch || row.expires_at_ms <= now) return null;
    if (!Number.isSafeInteger(row.expires_at_ms) || row.expires_at_ms < 0 || row.expires_at_ms % 1000 !== 0
      || !Number.isSafeInteger(row.admitted) || row.admitted < 0 || row.admitted > 10) {
      throw new Error('Judge gate unavailable');
    }
    return row;
  }

  #quota(row: SessionRow, now: number): Quota {
    const day = new Date(now).toISOString().slice(0, 10);
    const reset = Date.parse(day + 'T00:00:00.000Z') + 86400000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(reset) || reset < 0) {
      throw new Error('Judge gate unavailable');
    }
    const daily = this.ctx.storage.sql.exec<{ admitted: number }>(
      'SELECT admitted FROM daily WHERE utc_day = ?', day,
    ).toArray()[0]?.admitted ?? 0;
    if (!Number.isSafeInteger(daily) || daily < 0 || daily > 40) throw new Error('Judge gate unavailable');
    return {
      utc_day: day, reset_at_ms: reset, daily_limit: 40, daily_remaining: 40 - daily,
      session_limit: 10, session_remaining: 10 - row.admitted,
    };
  }

  #active(row: SessionRow, now: number): ActiveJudgeSession {
    return { version: 'judge-session-v1', state: 'active', expires_at_ms: row.expires_at_ms, quota: this.#quota(row, now) };
  }

  async status(token_sha256: string | null, code_epoch: string): Promise<JudgeSession> {
    this.#configured();
    requireHash(token_sha256, true);
    requireHash(code_epoch);
    return this.ctx.storage.transactionSync((): JudgeSession => {
      const now = Date.now();
      const row = this.#session(token_sha256, code_epoch, now);
      return row === null ? anonymousSession() : this.#active(row, now);
    });
  }

  async open(candidate_sha256: string, existing_sha256: string | null, code_epoch: string): Promise<JudgeOpen> {
    const ttl = this.#configured();
    requireHash(candidate_sha256);
    requireHash(existing_sha256, true);
    requireHash(code_epoch);
    return this.ctx.storage.transactionSync((): JudgeOpen => {
      const now = Date.now();
      const existing = this.#session(existing_sha256, code_epoch, now);
      if (existing !== null) return { session: this.#active(existing, now), reused: true };
      const expires = Math.floor(now / 1000) * 1000 + ttl * 1000;
      if (!Number.isSafeInteger(expires) || expires < 0) throw new Error('Judge gate unavailable');
      // A primary-key collision throws and rolls back; it must never reset a session.
      this.ctx.storage.sql.exec(
        'INSERT INTO sessions (token_sha256, expires_at_ms, admitted, code_epoch) VALUES (?, ?, 0, ?)',
        candidate_sha256, expires, code_epoch,
      ).toArray();
      return { session: this.#active({ expires_at_ms: expires, admitted: 0, code_epoch }, now), reused: false };
    });
  }

  async revoke(token_sha256: string | null): Promise<void> {
    this.#configured();
    requireHash(token_sha256, true);
    this.ctx.storage.transactionSync(() => {
      if (token_sha256 !== null) {
        this.ctx.storage.sql.exec('DELETE FROM obituary_claims WHERE token_sha256 = ?', token_sha256).toArray();
        this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_sha256 = ?', token_sha256).toArray();
      }
    });
  }

  async reserve(token_sha256: string, code_epoch: string): Promise<JudgeReservation> {
    this.#configured();
    requireHash(token_sha256);
    requireHash(code_epoch);
    return this.ctx.storage.transactionSync((): JudgeReservation => {
      const now = Date.now();
      const row = this.#session(token_sha256, code_epoch, now);
      if (row === null) return { kind: 'anonymous' };
      const quota = this.#quota(row, now);
      if (quota.daily_remaining === 0 || quota.session_remaining === 0) return { kind: 'rate_limited', quota };
      this.ctx.storage.sql.exec('UPDATE sessions SET admitted = admitted + 1 WHERE token_sha256 = ?', token_sha256).toArray();
      this.ctx.storage.sql.exec(`INSERT INTO daily (utc_day, admitted) VALUES (?, 1)
        ON CONFLICT(utc_day) DO UPDATE SET admitted = admitted + 1`, quota.utc_day).toArray();
      return { kind: 'admitted', quota: {
        ...quota, daily_remaining: quota.daily_remaining - 1, session_remaining: quota.session_remaining - 1,
      } };
    });
  }

  async reserveObituary(token_sha256: string, code_epoch: string, operationKey: string): Promise<ObituaryReservation> {
    this.#configured();
    requireHash(token_sha256);
    requireHash(code_epoch);
    requireHash(operationKey);
    return this.ctx.storage.transactionSync((): ObituaryReservation => {
      const now = Date.now();
      const row = this.#session(token_sha256, code_epoch, now);
      if (row === null) return { kind: 'anonymous' };
      const quota = this.#quota(row, now);
      const claimed = this.ctx.storage.sql.exec(
        'SELECT operation_key FROM obituary_claims WHERE token_sha256 = ? AND operation_key = ?', token_sha256, operationKey,
      ).toArray();
      if (claimed.length !== 0) return { kind: 'duplicate', quota };
      if (quota.daily_remaining === 0 || quota.session_remaining === 0) return { kind: 'rate_limited', quota };
      this.ctx.storage.sql.exec(
        'INSERT INTO obituary_claims (token_sha256, operation_key) VALUES (?, ?)', token_sha256, operationKey,
      ).toArray();
      this.ctx.storage.sql.exec('UPDATE sessions SET admitted = admitted + 1 WHERE token_sha256 = ?', token_sha256).toArray();
      this.ctx.storage.sql.exec(`INSERT INTO daily (utc_day, admitted) VALUES (?, 1)
        ON CONFLICT(utc_day) DO UPDATE SET admitted = admitted + 1`, quota.utc_day).toArray();
      return { kind: 'admitted', quota: {
        ...quota, daily_remaining: quota.daily_remaining - 1, session_remaining: quota.session_remaining - 1,
      } };
    });
  }
}
