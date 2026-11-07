// Author approvals for Workers AI runs (R11.8, R11.20, DA-14).
// The file is read only from git: `git status --porcelain` must print nothing for it,
// and the content comes from `git show HEAD:<file>`. Both go through `execFile` with
// fixed argument arrays (no shell, no interpolated data). Any failure = not approved.
import { execFile } from 'node:child_process';
import { printErrorLine } from './sink.ts';

export const APPROVALS_SCHEMA = 'llm-probe-approvals-v1';
export const APPROVALS_PATH = 'eval/probe/approvals.json';

export type ApprovalKind = 'smoke' | 'dev' | 'locked' | 'phase2';

export interface Approval {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly combination?: string;
  readonly model?: string;
  readonly branch?: string;
  readonly task_subset?: string | null;
  readonly max_requests?: number;
  readonly phase2?: string;
  readonly approved_on: string;
  readonly note: string;
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

const KINDS: readonly string[] = ['smoke', 'dev', 'locked', 'phase2'];

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
