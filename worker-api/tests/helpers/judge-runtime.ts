import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, validateJudgeSourceConfig } from '../../scripts/profile.ts';
import { profileRuntimeFixture } from './runtime.ts';
import type { JudgeFixtureControls, RuntimeFixture, RuntimeFixtureOptions } from './runtime.ts';

export type JudgeRuntimeFixture = RuntimeFixture & JudgeFixtureControls;
export interface JudgeRuntimeFixtureOptions extends Pick<RuntimeFixtureOptions, 'variables' | 'result' | 'status'> {
  projectRoot?: string;
  persistencePath?: string;
  nowMs?: number;
  reserveFault?: 'reject-after-commit';
  traceSql?: boolean;
}

export async function judgeRuntimeFixture(options: JudgeRuntimeFixtureOptions = {}): Promise<JudgeRuntimeFixture> {
  const projectRoot = options.projectRoot ?? root;
  const config: unknown = JSON.parse(await readFile(join(projectRoot, 'worker-api/judge.jsonc'), 'utf8'));
  // Check the native profile before supplying any isolated fixture bindings.
  validateJudgeSourceConfig(config);
  return profileRuntimeFixture(config, 'judge', projectRoot, options);
}
