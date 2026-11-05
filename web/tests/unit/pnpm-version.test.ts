// Feature: web-shell, check-pnpm-version.sh unit test (task 2.13)
//
// Validates: Requirements 1.3
//
// check-pnpm-version.sh (R1.2, R1.3) checks that pnpm is pinned to the same exact
// major.minor.patch version in mise.toml and in the packageManager field of
// web/package.json. On any missing, malformed or differing value it prints both
// values (or "missing") and exits 1; it exits 0 only when both are present,
// well-formed and equal.
//
// The script resolves its inputs relative to its own location: it runs
// `cd "$(dirname "$0")/.."` and then reads `mise.toml` and `web/package.json`
// (the latter via `node -p`). To exercise it against controlled inputs without
// touching the repository files, each case builds a temporary repo-like layout
//   <tmp>/scripts/check-pnpm-version.sh   (a copy of the real script)
//   <tmp>/mise.toml
//   <tmp>/web/package.json
// and runs the copied script there, so the script's `cd ..` lands on <tmp>.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The real script, resolved relative to this test file:
// web/tests/unit/ -> repo root -> scripts/check-pnpm-version.sh.
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '..', '..', '..');
const realScript = path.join(repoRoot, 'scripts', 'check-pnpm-version.sh');

interface Fixture {
  /** Full text of the temporary mise.toml. */
  miseToml: string;
  /** Full text of the temporary web/package.json. */
  packageJson: string;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Build a temporary repo-like layout holding a copy of the real script plus the
 * given mise.toml and web/package.json, run the copied script there, and return
 * its exit status and output. The temporary directory is removed before returning.
 */
function runWithFixture(fixture: Fixture): RunResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'pnpm-version-'));
  try {
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'web'));
    cpSync(realScript, path.join(dir, 'scripts', 'check-pnpm-version.sh'));
    writeFileSync(path.join(dir, 'mise.toml'), fixture.miseToml);
    writeFileSync(path.join(dir, 'web', 'package.json'), fixture.packageJson);

    const result = spawnSync(
      'bash',
      [path.join(dir, 'scripts', 'check-pnpm-version.sh')],
      { encoding: 'utf8' },
    );
    assert.equal(
      result.error,
      undefined,
      `script failed to spawn: ${result.error?.message ?? ''}`,
    );
    return {
      status: result.status ?? -1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function miseWith(pnpmLine: string): string {
  return ['[tools]', 'node = "26.7.0"', pnpmLine, ''].join('\n');
}

function packageWith(packageManager: string | null): string {
  const obj: Record<string, unknown> = {
    name: 'fixture-web',
    private: true,
    type: 'module',
  };
  if (packageManager !== null) {
    obj.packageManager = packageManager;
  }
  return JSON.stringify(obj, null, 2) + '\n';
}

// Case (a): matching versions in both places -> exit 0, no "missing".
test('matching versions exit 0', () => {
  const result = runWithFixture({
    miseToml: miseWith('pnpm = "10.33.1"'),
    packageJson: packageWith('pnpm@10.33.1'),
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /10\.33\.1/);
  assert.doesNotMatch(result.stdout, /missing/);
});

// Case (b): same major.minor but a different patch -> exit 1, both values printed.
test('mismatched patch exits 1 and prints both values', () => {
  const result = runWithFixture({
    miseToml: miseWith('pnpm = "10.33.1"'),
    packageJson: packageWith('pnpm@10.33.2'),
  });
  assert.equal(result.status, 1, 'expected exit 1 on a patch mismatch');
  assert.match(result.stdout, /mise\.toml: 10\.33\.1/);
  assert.match(result.stdout, /web\/package\.json packageManager: pnpm@10\.33\.2/);
});

// Case (c): packageManager carries a range like ^10.33.1 -> not of the form
// pnpm@x.y.z, so it is treated as missing/invalid -> exit 1 with "missing".
test('packageManager range is treated as missing and exits 1', () => {
  const result = runWithFixture({
    miseToml: miseWith('pnpm = "10.33.1"'),
    packageJson: packageWith('pnpm@^10.33.1'),
  });
  assert.equal(result.status, 1, 'expected exit 1 for a range in packageManager');
  assert.match(result.stdout, /mise\.toml: 10\.33\.1/);
  assert.match(result.stdout, /web\/package\.json packageManager: missing/);
});

// Case (d): the packageManager field is absent entirely -> exit 1 with "missing".
test('missing packageManager field exits 1', () => {
  const result = runWithFixture({
    miseToml: miseWith('pnpm = "10.33.1"'),
    packageJson: packageWith(null),
  });
  assert.equal(result.status, 1, 'expected exit 1 when packageManager is absent');
  assert.match(result.stdout, /mise\.toml: 10\.33\.1/);
  assert.match(result.stdout, /web\/package\.json packageManager: missing/);
});

// Case (e): mise.toml has no pnpm line -> mise value is "missing" -> exit 1.
test('missing pnpm line in mise.toml exits 1', () => {
  const result = runWithFixture({
    miseToml: ['[tools]', 'node = "26.7.0"', ''].join('\n'),
    packageJson: packageWith('pnpm@10.33.1'),
  });
  assert.equal(result.status, 1, 'expected exit 1 when mise.toml has no pnpm line');
  assert.match(result.stdout, /mise\.toml: missing/);
  assert.match(result.stdout, /web\/package\.json packageManager: pnpm@10\.33\.1/);
});
