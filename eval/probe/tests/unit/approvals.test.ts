import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { APPROVALS_PATH, findApproval, loadApprovals, parseApprovals } from '../../src/approvals.ts';

const ENTRY = {
  id: 'A-001',
  kind: 'dev',
  combination: 'workers-ai/x',
  task_subset: 'S',
  max_requests: 30,
  approved_on: '2026-11-08',
  note: 'n',
};
const GOOD = `${JSON.stringify({ schema: 'llm-probe-approvals-v1', approvals: [ENTRY] })}\n`;

let root = '';
// Config only through -c flags on commands inside the throwaway repo.
const g = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  });

function repo(name: string): { dir: string; file: string } {
  const dir = path.join(root, name);
  mkdirSync(dir);
  g(dir, 'init', '-q');
  const file = path.join(dir, APPROVALS_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  return { dir, file };
}
function commit(dir: string, file: string, text: string): void {
  writeFileSync(file, text);
  g(dir, 'add', '--', APPROVALS_PATH);
  g(dir, 'commit', '-q', '-m', 'x');
}

before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'approvals-'));
});
after(() => rmSync(root, { recursive: true, force: true }));

test('committed and clean is accepted', async () => {
  const { dir, file } = repo('clean');
  commit(dir, file, GOOD);
  const lines: string[] = [];
  const r = await loadApprovals({ repoDir: dir, print: (l) => lines.push(l) });
  assert.ok(r.approved);
  assert.equal(r.approved && r.approvals.length, 1);
  assert.deepEqual(lines, []);
});

test('modified in the working tree is not approved, with a reason', async () => {
  const { dir, file } = repo('modified');
  commit(dir, file, GOOD);
  writeFileSync(file, `${GOOD}\n`);
  const lines: string[] = [];
  const r = await loadApprovals({ repoDir: dir, print: (l) => lines.push(l) });
  assert.equal(r.approved, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /not approved/);
});

test('staged-only change is not approved', async () => {
  const { dir, file } = repo('staged');
  commit(dir, file, GOOD);
  writeFileSync(file, `${GOOD}\n`);
  g(dir, 'add', '--', APPROVALS_PATH);
  const lines: string[] = [];
  const r = await loadApprovals({ repoDir: dir, print: (l) => lines.push(l) });
  assert.equal(r.approved, false);
  assert.equal(lines.length, 1);
});

test('untracked file is not approved', async () => {
  const { dir, file } = repo('untracked');
  writeFileSync(file, GOOD);
  const lines: string[] = [];
  const r = await loadApprovals({ repoDir: dir, print: (l) => lines.push(l) });
  assert.equal(r.approved, false);
  assert.equal(lines.length, 1);
});

test('not a git repository is not approved', async () => {
  const dir = path.join(root, 'plain');
  mkdirSync(dir);
  const lines: string[] = [];
  const r = await loadApprovals({ repoDir: dir, print: (l) => lines.push(l) });
  assert.equal(r.approved, false);
  assert.equal(lines.length, 1);
});

test('content comes from HEAD and entry lookup matches combination, subset and count', () => {
  const list = parseApprovals(GOOD);
  const q = { id: 'A-001', kind: 'dev', combination: 'workers-ai/x', task_subset: 'S', requestCount: 30 } as const;
  assert.ok(findApproval(list, q));
  assert.equal(findApproval(list, { ...q, requestCount: 31 }), undefined);
  assert.equal(findApproval(list, { ...q, combination: 'other' }), undefined);
  assert.equal(findApproval(list, { ...q, task_subset: 'D' }), undefined);
  assert.equal(findApproval(list, { ...q, kind: 'locked' }), undefined);
});

test('the committed empty approvals file parses and a bad schema is rejected', () => {
  assert.deepEqual(parseApprovals('{"schema":"llm-probe-approvals-v1","approvals":[]}\n'), []);
  assert.throws(() => parseApprovals('{"schema":"x","approvals":[]}'));
});
