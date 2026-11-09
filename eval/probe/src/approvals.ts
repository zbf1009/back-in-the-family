// Author approvals for Workers AI runs (R11.8, R11.20, DA-14).
// The file is read only from git: `git status --porcelain` must print nothing for it,
// and the content comes from `git show HEAD:<file>`. Both go through `execFile` with
// fixed argument arrays (no shell, no interpolated data). Any failure = not approved.
import { execFile } from 'node:child_process';
import { printErrorLine } from './sink.ts';

export const APPROVALS_SCHEMA = 'llm-probe-approvals-v1';
export const APPROVALS_PATH = 'eval/probe/approvals.json';

export type ApprovalKind = 'smoke' | 'dev' | 'locked' | 'phase2' | 'decision_model' | 'withdrawal';

/**
 * Steps a `decision_model` entry can name. There is no `smoke` step: a Decision_Model Smoke_Call needs no approval (RC-10).
 * `dev` and `locked` belong to a `single` entry; `derive_dev` and `derive_locked` to a `perm_avg` entry only (R20.10).
 */
export type DecisionStep = 'dev' | 'locked' | 'derive_dev' | 'derive_locked';
export type ApprovalVariant = 'single' | 'perm_avg';

export interface Approval {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly combination?: string;
  readonly model?: string;
  readonly branch?: string;
  readonly task_subset?: string | null;
  readonly max_requests?: number;
  readonly phase2?: string;
  /** `decision_model` only: the one step the entry covers (R19.4). */
  readonly step?: DecisionStep;
  /** `decision_model` only: the Decision_Variant the entry covers; absent means `single` (R20.10). */
  readonly variant?: ApprovalVariant;
  /** `withdrawal` only: IDs of the approvals it withdraws (DA-21). */
  readonly withdraws?: readonly string[];
  readonly withdrawn_on?: string;
  /** Present on every kind except `withdrawal`. */
  readonly approved_on?: string;
  readonly note?: string;
}

export type ApprovalsResult =
  | { readonly approved: true; readonly approvals: readonly Approval[] }
  | { readonly approved: false; readonly reason: string };

export interface ApprovalsOptions {
  /** Repository root; injectable for tests. */
  readonly repoDir: string;
  /** Prints the not-approved reason; defaults to stderr through sink.ts. */
  readonly print?: (line: string) => void;
}

const KINDS: readonly string[] = ['smoke', 'dev', 'locked', 'phase2', 'decision_model', 'withdrawal'];

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Strict checks for the R19.4 kinds (DA-21). Older kinds keep their existing, looser reading. */
function checkDecisionModel(r: Record<string, unknown>, at: string): void {
  for (const k of ['combination', 'step', 'task_subset', 'max_requests', 'approved_on'] as const) {
    if (r[k] === undefined) throw new Error(`${at} (decision_model) is missing ${k}`);
  }
  if (!nonEmpty(r['combination'])) throw new Error(`${at}.combination is not a non-empty string`);
  if (r['step'] === 'smoke') throw new Error(`${at}.step is smoke; a Decision_Model Smoke_Call needs no approval (RC-10)`);
  const variant = r['variant'];
  if (variant !== undefined && variant !== 'single' && variant !== 'perm_avg') throw new Error(`${at}.variant is not single or perm_avg`);
  if (variant === 'perm_avg') {
    // A Decision_Variant derives; it never runs (R20.9, R20.10). Its entries name a derive step and send 0 requests.
    if (r['step'] !== 'derive_dev' && r['step'] !== 'derive_locked') throw new Error(`${at}.step is not derive_dev or derive_locked (perm_avg)`);
    if (r['max_requests'] !== 0) throw new Error(`${at}.max_requests is not 0 (a derive step sends no request)`);
  } else {
    if (r['step'] === 'derive_dev' || r['step'] === 'derive_locked') throw new Error(`${at}.step ${String(r['step'])} needs "variant": "perm_avg"`);
    if (r['step'] !== 'dev' && r['step'] !== 'locked') throw new Error(`${at}.step is not dev or locked`);
    if (typeof r['max_requests'] !== 'number' || !Number.isInteger(r['max_requests']) || r['max_requests'] < 1) throw new Error(`${at}.max_requests is not a positive integer`);
  }
  if (r['task_subset'] !== 'D') throw new Error(`${at}.task_subset is not D (R19.1)`);
  if (!nonEmpty(r['approved_on'])) throw new Error(`${at}.approved_on is not a non-empty string`);
  if ('phase2' in r) throw new Error(`${at} (decision_model) has a phase2 member`);
}

function checkWithdrawal(r: Record<string, unknown>, at: string): void {
  for (const k of ['withdraws', 'withdrawn_on'] as const) {
    if (r[k] === undefined) throw new Error(`${at} (withdrawal) is missing ${k}`);
  }
  const w = r['withdraws'];
  if (!Array.isArray(w) || w.length === 0 || !w.every(nonEmpty)) throw new Error(`${at}.withdraws is not a non-empty list of IDs`);
  if (!nonEmpty(r['withdrawn_on'])) throw new Error(`${at}.withdrawn_on is not a non-empty string`);
}

function git(repoDir: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/** Parses approvals text; throws a plain Error naming the first problem. */
export function parseApprovals(text: string): Approval[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('approvals.json is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('approvals.json is not an object');
  const obj = value as Record<string, unknown>;
  if (obj['schema'] !== APPROVALS_SCHEMA) throw new Error(`approvals.json schema is not ${APPROVALS_SCHEMA}`);
  const list = obj['approvals'];
  if (!Array.isArray(list)) throw new Error('approvals.json "approvals" is not a list');
  const seen = new Set<string>();
  for (const [i, e] of list.entries()) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new Error(`approvals[${i}] is not an object`);
    const r = e as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || r['id'] === '') throw new Error(`approvals[${i}].id is not a non-empty string`);
    if (seen.has(r['id'])) throw new Error(`approvals[${i}].id is a duplicate`);
    seen.add(r['id']);
    if (typeof r['kind'] !== 'string' || !KINDS.includes(r['kind'])) throw new Error(`approvals[${i}].kind is not legal`);
    if (r['kind'] === 'decision_model') checkDecisionModel(r, `approvals[${i}]`);
    if (r['kind'] === 'withdrawal') checkWithdrawal(r, `approvals[${i}]`);
  }
  // A withdrawal names existing decision_model entries of the same file (DA-21).
  const dm = new Set((list as Record<string, unknown>[]).filter((e) => e['kind'] === 'decision_model').map((e) => e['id'] as string));
  for (const [i, e] of (list as Record<string, unknown>[]).entries()) {
    if (e['kind'] !== 'withdrawal') continue;
    for (const id of e['withdraws'] as string[]) if (!dm.has(id)) throw new Error(`approvals[${i}].withdraws names ${id}, which is not a decision_model entry`);
  }
  return list as Approval[];
}

/**
 * Reads the approvals from git `HEAD`, provided the file has no change in the index or
 * the working tree and is tracked. Prints the reason when not approved.
 */
export async function loadApprovals(options: ApprovalsOptions): Promise<ApprovalsResult> {
  const print = options.print ?? printErrorLine;
  const fail = (reason: string): ApprovalsResult => {
    print(`not approved: ${reason}`);
    return { approved: false, reason };
  };
  try {
    const status = await git(options.repoDir, ['status', '--porcelain', '--', APPROVALS_PATH]);
    if (status.trim() !== '') return fail(`${APPROVALS_PATH} has uncommitted changes or is untracked`);
    const content = await git(options.repoDir, ['show', `HEAD:${APPROVALS_PATH}`]);
    return { approved: true, approvals: parseApprovals(content) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export interface ApprovalQuery {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly combination: string;
  readonly task_subset: string | null;
  readonly requestCount: number;
}

/** Finds the entry matching id, kind, Combination, subset and a request count within its cap. */
export function findApproval(approvals: readonly Approval[], query: ApprovalQuery): Approval | undefined {
  return approvals.find(
    (a) =>
      a.id === query.id &&
      a.kind === query.kind &&
      a.combination === query.combination &&
      (a.task_subset ?? null) === query.task_subset &&
      a.max_requests !== undefined &&
      query.requestCount <= a.max_requests,
  );
}
